
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../config/supabase.js';
import { authenticate, checkPermission } from '../middleware/auth.js';

const router = Router();

const CONTACT_TYPES = ['cliente', 'proveedor'];
const DOCUMENT_TYPES = ['cedula', 'ruc', 'pasaporte', 'otro'];

const parseMoney = (value, fieldName) => {
  if (value === undefined || value === null || value === '') {
    return { value: 0 };
  }

  const amount = Number(value);

  if (!Number.isFinite(amount) || amount < 0) {
    return {
      error: `${fieldName} debe ser un número válido mayor o igual a cero`
    };
  }

  return { value: amount };
};

// Normaliza datos de texto sin alterar innecesariamente su contenido.
const cleanText = (value) => {
  if (typeof value !== 'string') return value;
  const cleaned = value.trim();
  return cleaned || null;
};

const normalizeDocument = (value) => {
  const cleaned = cleanText(value);
  return cleaned ? cleaned.toUpperCase() : null;
};

const normalizePhone = (value) => {
  const phone = cleanText(value);
  if (!phone) return null;

  // Si el usuario escribe un número nicaragüense de 8 dígitos,
  // se agrega el prefijo internacional +505.
  const digits = phone.replace(/\D/g, '');

  if (digits.length === 8 && !phone.startsWith('+')) {
    return `+505 ${digits}`;
  }

  return phone;
};

// CU-14/16: Listar contactos
router.get(
  '/',
  authenticate,
  checkPermission('contactos', 'read'),
  async (req, res) => {
    try {
      const { type, search, document_number, is_active } = req.query;

      if (type && !CONTACT_TYPES.includes(type)) {
        return res.status(400).json({ error: 'Tipo de contacto inválido' });
      }

      if (
        is_active !== undefined &&
        !['true', 'false'].includes(String(is_active))
      ) {
        return res.status(400).json({ error: 'El filtro is_active es inválido' });
      }

      let query = supabase
        .from('contacts')
        .select('*')
        .eq('company_id', req.user.company_id)
        .order('created_at', { ascending: false });

      if (type) query = query.eq('type', type);

      if (is_active !== undefined) {
        query = query.eq('is_active', is_active === 'true');
      }

      if (document_number) {
        query = query.eq('document_number', normalizeDocument(document_number));
      }

      if (search) {
        // Evita que comas o paréntesis introducidos en la búsqueda
        // alteren la sintaxis del filtro OR de PostgREST.
        const safeSearch = String(search)
          .trim()
          .replace(/[,%()]/g, ' ');

        if (safeSearch) {
          query = query.or(
            `name.ilike.%${safeSearch}%,business_name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%,document_number.ilike.%${safeSearch}%`
          );
        }
      }

      const { data, error } = await query;

      if (error) throw error;

      const contacts = data || [];

      const stats = {
        total: contacts.length,
        clientes: contacts.filter(c => c.type === 'cliente').length,
        proveedores: contacts.filter(c => c.type === 'proveedor').length,
        balance_total: contacts.reduce(
          (sum, c) => sum + Number(c.balance || 0),
          0
        ),
        credit_limit_total: contacts.reduce(
          (sum, c) => sum + Number(c.credit_limit || 0),
          0
        )
      };

      res.json({ contacts, stats });
    } catch (err) {
      console.error('Error listando contactos:', err);
      res.status(500).json({ error: 'Error al listar contactos' });
    }
  }
);

// Estadísticas rápidas: debe estar antes de /:id
router.get(
  '/stats/summary',
  authenticate,
  checkPermission('contactos', 'read'),
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('type, balance, credit_limit')
        .eq('company_id', req.user.company_id)
        .eq('is_active', true);

      if (error) throw error;

      const contacts = data || [];
      const clients = contacts.filter(c => c.type === 'cliente');
      const suppliers = contacts.filter(c => c.type === 'proveedor');

      res.json({
        clients: {
          total: clients.length,
          balance_total: clients.reduce(
            (sum, c) => sum + Number(c.balance || 0),
            0
          ),
          credit_limit_total: clients.reduce(
            (sum, c) => sum + Number(c.credit_limit || 0),
            0
          )
        },
        suppliers: {
          total: suppliers.length,
          balance_total: suppliers.reduce(
            (sum, s) => sum + Number(s.balance || 0),
            0
          )
        }
      });
    } catch (err) {
      console.error('Error obteniendo estadísticas de contactos:', err);
      res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
  }
);

// CU-14/16: Obtener un contacto
router.get(
  '/:id',
  authenticate,
  checkPermission('contactos', 'read'),
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', req.params.id)
        .eq('company_id', req.user.company_id)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return res.status(404).json({ error: 'Contacto no encontrado' });
      }

      res.json({ contact: data });
    } catch (err) {
      console.error('Error obteniendo contacto:', err);
      res.status(500).json({ error: 'Error al obtener contacto' });
    }
  }
);

// CU-14/16: Crear contacto
router.post(
  '/',
  authenticate,
  checkPermission('contactos', 'create'),
  async (req, res) => {
    try {
      const {
        type,
        document_type,
        document_number,
        name,
        business_name,
        email,
        phone,
        address,
        credit_limit,
        balance,
        notes
      } = req.body;

      if (!type || !name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({
          error: 'El tipo y el nombre del contacto son requeridos'
        });
      }

      if (!CONTACT_TYPES.includes(type)) {
        return res.status(400).json({ error: 'Tipo de contacto inválido' });
      }

      const docType = document_type || 'otro';

      if (!DOCUMENT_TYPES.includes(docType)) {
        return res.status(400).json({
          error: 'Tipo de documento inválido. Use cedula, ruc, pasaporte u otro'
        });
      }

      const normalizedDocument = normalizeDocument(document_number);

      if (normalizedDocument && !document_type) {
        return res.status(400).json({
          error: 'Indique el tipo de documento seleccionado'
        });
      }

      const creditResult = parseMoney(credit_limit, 'El límite de crédito');
      if (creditResult.error) {
        return res.status(400).json({ error: creditResult.error });
      }

      const balanceResult = parseMoney(balance, 'El saldo');
      if (balanceResult.error) {
        return res.status(400).json({ error: balanceResult.error });
      }

      // Verificar documento repetido dentro de la empresa y tipo de contacto.
      if (normalizedDocument) {
        const { data: existing, error: duplicateError } = await supabase
          .from('contacts')
          .select('id')
          .eq('company_id', req.user.company_id)
          .eq('document_number', normalizedDocument)
          .eq('type', type)
          .maybeSingle();

        if (duplicateError) throw duplicateError;

        if (existing) {
          return res.status(409).json({
            error: `Ya existe un ${type} con ese número de documento`
          });
        }
      }

      const { data, error } = await supabase
        .from('contacts')
        .insert({
          id: uuidv4(),
          company_id: req.user.company_id,
          type,
          document_type: docType,
          document_number: normalizedDocument,
          name: name.trim(),
          business_name: cleanText(business_name),
          email: cleanText(email),
          phone: normalizePhone(phone),
          address: cleanText(address),
          credit_limit: creditResult.value,
          balance: balanceResult.value,
          notes: cleanText(notes),
          is_active: true
        })
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({
        message: `${type === 'cliente' ? 'Cliente' : 'Proveedor'} creado exitosamente`,
        contact: data
      });
    } catch (err) {
      console.error('Error creando contacto:', err);
      res.status(500).json({ error: 'Error al crear contacto' });
    }
  }
);

// CU-14/16: Actualizar contacto
router.put(
  '/:id',
  authenticate,
  checkPermission('contactos', 'update'),
  async (req, res) => {
    try {
      const { data: existing, error: findError } = await supabase
        .from('contacts')
        .select('id, type')
        .eq('id', req.params.id)
        .eq('company_id', req.user.company_id)
        .maybeSingle();

      if (findError) throw findError;

      if (!existing) {
        return res.status(404).json({ error: 'Contacto no encontrado' });
      }

      const updateData = {};
      const fields = [
        'name',
        'business_name',
        'email',
        'phone',
        'address',
        'document_type',
        'document_number',
        'credit_limit',
        'balance',
        'notes',
        'is_active'
      ];

      for (const field of fields) {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field];
        }
      }

      if (updateData.name !== undefined) {
        if (typeof updateData.name !== 'string' || !updateData.name.trim()) {
          return res.status(400).json({ error: 'El nombre no puede estar vacío' });
        }
        updateData.name = updateData.name.trim();
      }

      if (updateData.document_type !== undefined) {
        if (!DOCUMENT_TYPES.includes(updateData.document_type)) {
          return res.status(400).json({ error: 'Tipo de documento inválido' });
        }
      }

      if (updateData.document_number !== undefined) {
        updateData.document_number = normalizeDocument(updateData.document_number);
      }

      if (updateData.phone !== undefined) {
        updateData.phone = normalizePhone(updateData.phone);
      }

      if (updateData.business_name !== undefined) {
        updateData.business_name = cleanText(updateData.business_name);
      }

      if (updateData.email !== undefined) {
        updateData.email = cleanText(updateData.email);
      }

      if (updateData.address !== undefined) {
        updateData.address = cleanText(updateData.address);
      }

      if (updateData.notes !== undefined) {
        updateData.notes = cleanText(updateData.notes);
      }

      for (const field of ['credit_limit', 'balance']) {
        if (updateData[field] !== undefined) {
          const result = parseMoney(updateData[field], field);
          if (result.error) {
            return res.status(400).json({ error: result.error });
          }
          updateData[field] = result.value;
        }
      }

      if (
        updateData.is_active !== undefined &&
        typeof updateData.is_active !== 'boolean'
      ) {
        return res.status(400).json({
          error: 'El estado is_active debe ser verdadero o falso'
        });
      }

      if (updateData.document_number) {
        const { data: duplicate, error: duplicateError } = await supabase
          .from('contacts')
          .select('id')
          .eq('company_id', req.user.company_id)
          .eq('type', existing.type)
          .eq('document_number', updateData.document_number)
          .neq('id', req.params.id)
          .maybeSingle();

        if (duplicateError) throw duplicateError;

        if (duplicate) {
          return res.status(409).json({
            error: 'Ya existe otro contacto con ese documento'
          });
        }
      }

      const { data, error } = await supabase
        .from('contacts')
        .update(updateData)
        .eq('id', req.params.id)
        .eq('company_id', req.user.company_id)
        .select()
        .single();

      if (error) throw error;

      res.json({ message: 'Contacto actualizado', contact: data });
    } catch (err) {
      console.error('Error actualizando contacto:', err);
      res.status(500).json({ error: 'Error al actualizar contacto' });
    }
  }
);

// CU-14/16: Eliminar contacto (desactivación lógica)
router.delete(
  '/:id',
  authenticate,
  checkPermission('contactos', 'delete'),
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('contacts')
        .update({ is_active: false })
        .eq('id', req.params.id)
        .eq('company_id', req.user.company_id)
        .select('id')
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return res.status(404).json({ error: 'Contacto no encontrado' });
      }

      res.json({ message: 'Contacto desactivado' });
    } catch (err) {
      console.error('Error desactivando contacto:', err);
      res.status(500).json({ error: 'Error al desactivar contacto' });
    }
  }
);

export default router;
