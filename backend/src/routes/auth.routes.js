import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// CU-01: Iniciar sesión
router.post('/login', async (req, res) => {
  try {
    console.log(' Intento de login:', req.body.email);
    
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    
const { data: user, error } = await supabase
  .from('users')
  .select(`
    id,
    email,
    password_hash,
    full_name,
    role,
    is_active,
    company_id,
    branch_id,
    companies!inner (
      name
    ),
    branches (
      name,
      code
    )
  `)
  .eq('email', email.toLowerCase().trim())
  .single();

    if (error) {
      console.error('❌ Error buscando usuario:', error);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (!user) {
      console.log('⚠️ Usuario no encontrado:', email);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Cuenta desactivada' });
    }

    console.log('✅ Usuario encontrado:', user.email);

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      console.log('❌ Contraseña incorrecta');
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    console.log('✅ Contraseña correcta');

    // Actualizar último login
    await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    // Generar JWT
    const token = jwt.sign(
      { userId: user.id, role: user.role, companyId: user.company_id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    console.log('✅ Token generado');

    // Obtener permisos del rol
    const { data: permissions } = await supabase
      .from('role_permissions')
      .select('*')
      .eq('role', user.role);

    console.log('✅ Login exitoso para:', user.email);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        
company: {
  id: user.company_id,
  name: user.companies.name
},
branch: user.branches ? {
  id: user.branch_id,
  name: user.branches.name,
  code: user.branches.code
} : null

      },
      permissions: permissions || []
    });
  } catch (err) {
    console.error(' Error en login:', err);
    res.status(500).json({ error: 'Error en el servidor: ' + err.message });
  }
});

// CU-01: Cerrar sesión
router.post('/logout', authenticate, async (req, res) => {
  res.json({ message: 'Sesión cerrada exitosamente' });
});

// Obtener usuario actual
router.get('/me', authenticate, async (req, res) => {
  const { data: permissions } = await supabase
    .from('role_permissions')
    .select('*')
    .eq('role', req.user.role);

  res.json({
    user: req.user,
    permissions: permissions || []
  });
});

export default router;