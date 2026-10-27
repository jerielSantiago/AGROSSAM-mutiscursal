import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authenticate, checkPermission } from '../middleware/auth.js';

const router = Router();

router.get(
  '/',
  authenticate,
  checkPermission('inventario', 'read'),
  async (req, res) => {
    try {
      let query = supabase
        .from('purchases')
        .select(`
          *,
          contacts!purchases_supplier_id_fkey(id, name, document_number),
          warehouses!purchases_warehouse_id_fkey(id, name),
          purchase_items(id, product_id, description, quantity, unit_cost, tax_rate, tax_amount, line_total)
        `)
        .eq('company_id', req.user.company_id)
        .order('created_at', { ascending: false });

      if (!req.user.branch_id) {
        return res.status(403).json({ error: 'El usuario no tiene una sucursal asignada' });
      }
      query = query.eq('branch_id', req.user.branch_id);

      const { data, error } = await query;
      if (error) throw error;

      res.json({ purchases: data || [] });
    } catch (err) {
      console.error('Error listando compras:', err);
      res.status(500).json({ error: 'No se pudieron cargar las compras' });
    }
  }
);

router.post(
  '/',
  authenticate,
  checkPermission('inventario', 'update'),
  async (req, res) => {
    try {
      if (!req.user.branch_id) {
        return res.status(403).json({ error: 'El usuario no tiene una sucursal asignada' });
      }

      const {
        supplier_id,
        warehouse_id,
        supplier_invoice_number,
        purchase_date,
        notes,
        items
      } = req.body;

      if (!supplier_id || !warehouse_id || !Array.isArray(items) || !items.length) {
        return res.status(400).json({
          error: 'Proveedor, bodega y al menos un producto son requeridos'
        });
      }

      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (
        !uuidPattern.test(supplier_id) ||
        !uuidPattern.test(warehouse_id) ||
        (purchase_date && !/^\d{4}-\d{2}-\d{2}$/.test(purchase_date)) ||
        (supplier_invoice_number != null && typeof supplier_invoice_number !== 'string') ||
        (notes != null && typeof notes !== 'string') ||
        (supplier_invoice_number?.length || 0) > 100 ||
        (notes?.length || 0) > 500
      ) {
        return res.status(400).json({ error: 'Los datos generales de la compra no son válidos' });
      }

      if (items.length > 200 || items.some(item =>
        !item ||
        typeof item !== 'object' ||
        typeof item.product_id !== 'string' ||
        !uuidPattern.test(item.product_id) ||
        !Number.isFinite(Number(item.quantity)) ||
        Number(item.quantity) <= 0 ||
        !Number.isFinite(Number(item.unit_cost)) ||
        Number(item.unit_cost) < 0 ||
        (item.tax_rate !== undefined &&
          (!Number.isFinite(Number(item.tax_rate)) ||
            Number(item.tax_rate) < 0 ||
            Number(item.tax_rate) > 100))
      )) {
        return res.status(400).json({
          error: 'Verifica que cada producto tenga cantidad, costo e impuesto válidos'
        });
      }

      const { data, error } = await supabase.rpc('register_purchase', {
        p_company_id: req.user.company_id,
        p_branch_id: req.user.branch_id,
        p_supplier_id: supplier_id,
        p_warehouse_id: warehouse_id,
        p_user_id: req.user.id,
        p_supplier_invoice_number: supplier_invoice_number?.trim() || null,
        p_purchase_date: purchase_date || new Date().toISOString().slice(0, 10),
        p_notes: notes?.trim() || null,
        p_items: items.map(item => ({
          product_id: item.product_id,
          quantity: Number(item.quantity),
          unit_cost: Number(item.unit_cost),
          tax_rate: item.tax_rate === undefined || item.tax_rate === ''
            ? 15
            : Number(item.tax_rate)
        }))
      });

      if (error) throw error;

      res.status(201).json({
        message: 'Compra registrada y existencias actualizadas',
        purchase: data
      });
    } catch (err) {
      console.error('Error registrando compra:', err);
      const status = ['P0001', '22023', '22008', '23505'].includes(err.code) ? 400 : 500;
      res.status(status).json({
        error: status === 400
          ? err.message
          : 'No se pudo registrar la compra. Verifica que la migración de compras esté instalada en Supabase.',
        detail: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

export default router;
