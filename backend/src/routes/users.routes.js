import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../config/supabase.js';
import { authenticate, authorize, checkPermission } from '../middleware/auth.js';

const router = Router();

// CU-02: Listar usuarios
router.get('/', authenticate, checkPermission('usuarios', 'read'), async (req, res) => {
  try {
    const { role, is_active, search } = req.query;

    let query = supabase
      .from('users')
      .select(`
        id, email, full_name, role, is_active, last_login, created_at,
        branches!inner(name, code)
      `)
      .eq('company_id', req.user.company_id)
      .order('created_at', { ascending: false });

    if (role) query = query.eq('role', role);
    if (is_active !== undefined) query = query.eq('is_active', is_active === 'true');
    if (search) {
      query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({ users: data || [], total: data?.length || 0 });
  } catch (err) {
    console.error('Error listando usuarios:', err);
    res.status(500).json({ error: 'Error al listar usuarios' });
  }
});

// CU-02: Obtener un usuario
router.get('/:id', authenticate, checkPermission('usuarios', 'read'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select(`
        id, email, full_name, role, is_active, branch_id, created_at,
        branches!inner(id, name , code )
      `)
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ user: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
});

// CU-02: Crear usuario
router.post('/', authenticate, checkPermission('usuarios', 'create'), async (req, res) => {
  try {
    const { email, password, full_name, role, branch_id } = req.body;

    // Validaciones
    if (!email || !password || !full_name || !role) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    if (!['administrador', 'admin_sucursal', 'ventas', 'inventario', 'contabilidad'].includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    // Verificar que el email no exista
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (existing) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    // Verificar que la sucursal pertenezca a la misma empresa
    if (branch_id) {
      const { data: branch } = await supabase
        .from('branches')
        .select('id')
        .eq('id', branch_id)
        .eq('company_id', req.user.company_id)
        .single();

      if (!branch) {
        return res.status(400).json({ error: 'Sucursal no válida para esta empresa' });
      }
    }

    // Hash de contraseña
    const password_hash = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from('users')
      .insert({
        id: uuidv4(),
        company_id: req.user.company_id,
        email: email.toLowerCase().trim(),
        password_hash,
        full_name,
        role,
        branch_id: branch_id || null,
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      message: 'Usuario creado exitosamente',
      user: {
        id: data.id,
        email: data.email,
        full_name: data.full_name,
        role: data.role
      }
    });
  } catch (err) {
    console.error('Error creando usuario:', err);
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

// CU-02: Actualizar usuario
router.put('/:id', authenticate, checkPermission('usuarios', 'update'), async (req, res) => {
  try {
    const { full_name, role, branch_id, is_active } = req.body;

    // Verificar que el usuario exista y pertenezca a la empresa
    const { data: existing, error: fetchError } = await supabase
      .from('users')
      .select('id')
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // No permitir que un usuario se desactive a sí mismo
    if (req.params.id === req.user.id && is_active === false) {
      return res.status(400).json({ error: 'No puede desactivar su propia cuenta' });
    }

    const updateData = {};
    if (full_name) updateData.full_name = full_name;
    if (role) updateData.role = role;
    if (branch_id !== undefined) updateData.branch_id = branch_id;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: 'Usuario actualizado exitosamente',
      user: data
    });
  } catch (err) {
    console.error('Error actualizando usuario:', err);
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

// CU-02: Cambiar contraseña
router.put('/:id/password', authenticate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }

    // Solo el propio usuario o un admin puede cambiar la contraseña
    if (req.params.id !== req.user.id && req.user.role !== 'administrador') {
      return res.status(403).json({ error: 'No tiene permisos' });
    }

    // Si es el propio usuario, verificar contraseña actual
    if (req.params.id === req.user.id) {
      const { data: user } = await supabase
        .from('users')
        .select('password_hash')
        .eq('id', req.user.id)
        .single();

      const valid = await bcrypt.compare(current_password, user.password_hash);
      if (!valid) {
        return res.status(400).json({ error: 'Contraseña actual incorrecta' });
      }
    }

    const password_hash = await bcrypt.hash(new_password, 10);

    await supabase
      .from('users')
      .update({ password_hash })
      .eq('id', req.params.id);

    res.json({ message: 'Contraseña actualizada exitosamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al cambiar contraseña' });
  }
});

// CU-02: Eliminar usuario (soft delete - desactivar)
router.delete('/:id', authenticate, checkPermission('usuarios', 'delete'), async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'No puede eliminar su propia cuenta' });
    }

    const { error } = await supabase
      .from('users')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id);

    if (error) throw error;

    res.json({ message: 'Usuario desactivado exitosamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

export default router;