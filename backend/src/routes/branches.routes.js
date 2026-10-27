import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../config/supabase.js';
import { authenticate, authorize, checkPermission } from '../middleware/auth.js';

const router = Router();

// CU-03: Listar sucursales
router.get('/', authenticate, checkPermission('sucursales', 'read'), async (req, res) => {
  try {
    const { is_active, search } = req.query;

    let query = supabase
      .from('branches')
      .select(`
        id, name, code, address, phone, email, is_active, created_at,
        users!users_branch_id_fkey(id, full_name, email))
      `)
      .eq('company_id', req.user.company_id)
      .order('created_at', { ascending: false });

    if (is_active !== undefined) query = query.eq('is_active', is_active === 'true');
    if (search) {
      query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({ branches: data || [], total: data?.length || 0 });
  } catch (err) {
    console.error('Error listando sucursales:', err);
    res.status(500).json({ error: 'Error al listar sucursales' });
  }
});

// CU-03: Obtener una sucursal
router.get('/:id', authenticate, checkPermission('sucursales', 'read'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('branches')
      .select(`
        id, name, code, address, phone, email, is_active, created_at,
        users!users_branch_id_fkey(id, full_name, email, role)
      `)
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Sucursal no encontrada' });
    }

    res.json({ branch: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener sucursal' });
  }
});

// CU-03: Crear sucursal (solo Administrador)
router.post('/', authenticate, authorize('administrador'), checkPermission('sucursales', 'create'), async (req, res) => {
  try {
    const { name, code, address, phone, email } = req.body;

    if (!name || !code) {
      return res.status(400).json({ error: 'Nombre y código son requeridos' });
    }

    // Verificar que el código no exista en la empresa
    const { data: existing } = await supabase
      .from('branches')
      .select('id')
      .eq('company_id', req.user.company_id)
      .eq('code', code.toUpperCase().trim())
      .single();

    if (existing) {
      return res.status(400).json({ error: 'El código de sucursal ya existe en esta empresa' });
    }

    const { data, error } = await supabase
      .from('branches')
      .insert({
        id: uuidv4(),
        company_id: req.user.company_id,
        name,
        code: code.toUpperCase().trim(),
        address: address || null,
        phone: phone || null,
        email: email || null,
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      message: 'Sucursal creada exitosamente',
      branch: data
    });
  } catch (err) {
    console.error('Error creando sucursal:', err);
    res.status(500).json({ error: 'Error al crear sucursal' });
  }
});

// CU-03: Actualizar sucursal
router.put('/:id', authenticate, checkPermission('sucursales', 'update'), async (req, res) => {
  try {
    const { name, code, address, phone, email, is_active } = req.body;

    const { data: existing, error: fetchError } = await supabase
      .from('branches')
      .select('id')
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ error: 'Sucursal no encontrada' });
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (code) updateData.code = code.toUpperCase().trim();
    if (address !== undefined) updateData.address = address;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data, error } = await supabase
      .from('branches')
      .update(updateData)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: 'Sucursal actualizada exitosamente',
      branch: data
    });
  } catch (err) {
    console.error('Error actualizando sucursal:', err);
    res.status(500).json({ error: 'Error al actualizar sucursal' });
  }
});

// CU-03: Eliminar sucursal (soft delete)
router.delete('/:id', authenticate, authorize('administrador'), checkPermission('sucursales', 'delete'), async (req, res) => {
  try {
    const { error } = await supabase
      .from('branches')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id);

    if (error) throw error;

    res.json({ message: 'Sucursal desactivada exitosamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar sucursal' });
  }
});

export default router;