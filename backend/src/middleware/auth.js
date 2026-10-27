import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase.js';

export const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    console.log('🔎 Auth header recibido:', !!req.headers.authorization);
    console.log('🔎 Token recibido:', !!token);
    console.log('🔎 JWT_SECRET definido:', !!process.env.JWT_SECRET);

    if (!token) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ JWT válido. ID del usuario:', decoded.userId);

    
const { data: user, error } = await supabase
  .from('users')
  .select(`
    id, email, full_name, role, is_active, company_id, branch_id,
    companies!inner(name),
    branches!inner(name, code)
  `)
  .eq('id', decoded.userId)
  .single();

      
      console.log('🔎 Error de consulta Supabase:', error?.message || 'ninguno');
console.log('🔎 Usuario encontrado en consulta:', !!user);

    if (error || !user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Cuenta desactivada' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('Error verificando JWT:', err.name, err.message);

    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado' });
    }

    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token inválido' });
    }

    return res.status(401).json({ error: 'Error de autenticación' });
  }
};

export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'No tiene permisos para esta acción',
        required: allowedRoles,
        current: req.user.role
      });
    }

    next();
  };
};

export const checkPermission = (module, action) => {
  return async (req, res, next) => {
    try {
      const { data: permission } = await supabase
        .from('role_permissions')
        .select('*')
        .eq('role', req.user.role)
        .eq('module', module)
        .single();

      if (!permission) {
        return res.status(403).json({ error: 'Sin permisos configurados' });
      }

      const actionMap = {
        create: 'can_create',
        read: 'can_read',
        update: 'can_update',
        delete: 'can_delete',
        export: 'can_export'
      };

      if (!permission[actionMap[action]]) {
        return res.status(403).json({
          error: `No tiene permiso de ${action} en ${module}`
        });
      }

      next();
    } catch (err) {
      res.status(500).json({ error: 'Error verificando permisos' });
    }
  };
};