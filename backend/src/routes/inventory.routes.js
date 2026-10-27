import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../config/supabase.js';
import { authenticate, checkPermission } from '../middleware/auth.js';

const router = Router();

async function validateBranchProductAndWarehouse(req, productId, warehouseId) {
  if (!req.user.branch_id) {
    return 'El usuario no tiene una sucursal asignada.';
  }

  const [{ data: product, error: productError }, { data: warehouse, error: warehouseError }] =
    await Promise.all([
      supabase
        .from('products')
        .select('id')
        .eq('id', productId)
        .eq('company_id', req.user.company_id)
        .eq('branch_id', req.user.branch_id)
        .maybeSingle(),
      supabase
        .from('warehouses')
        .select('id')
        .eq('id', warehouseId)
        .eq('branch_id', req.user.branch_id)
        .eq('is_active', true)
        .maybeSingle()
    ]);

  if (productError) throw productError;
  if (warehouseError) throw warehouseError;
  if (!product) return 'El producto no pertenece a esta sucursal.';
  if (!warehouse) return 'La bodega no pertenece a esta sucursal o está inactiva.';
  return null;
}

// ============================================
// BODEGAS
// ============================================

router.get('/warehouses', authenticate, checkPermission('inventario', 'read'), async (req, res) => {
  try {
    if (!req.user.branch_id) {
      return res.status(403).json({ error: 'El usuario no tiene una sucursal asignada' });
    }

    let query = supabase
      .from('warehouses')
      .select(`
        *,
        branches!inner(id, name , code )
      `)
      .eq('branches.company_id', req.user.company_id)
      .eq('branch_id', req.user.branch_id)
      .order('name');

    const { data, error } = await query;
    if (error) throw error;

    res.json({ warehouses: data || [] });
  } catch (err) {
    res.status(500).json({ error: 'Error al listar bodegas' });
  }
});

router.post('/warehouses', authenticate, checkPermission('inventario', 'create'), async (req, res) => {
  try {
    const { branch_id, name, location } = req.body;

    if (!branch_id || !name) {
      return res.status(400).json({ error: 'Sucursal y nombre son requeridos' });
    }

    // Verificar que la sucursal sea de la empresa
    const { data: branch } = await supabase
      .from('branches')
      .select('id')
      .eq('id', branch_id)
      .eq('company_id', req.user.company_id)
      .single();

    if (!branch) {
      return res.status(400).json({ error: 'Sucursal no válida' });
    }
    if (req.user.branch_id && branch_id !== req.user.branch_id) {
      return res.status(403).json({ error: 'Solo puede crear bodegas en su sucursal' });
    }

    const { data, error } = await supabase
      .from('warehouses')
      .insert({
        id: uuidv4(),
        branch_id,
        name,
        location: location || null,
        is_active: true
      })
      .select(`*, branches!inner(name )`)
      .single();

    if (error) throw error;

    res.status(201).json({ message: 'Bodega creada', warehouse: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al crear bodega' });
  }
});

// ============================================
// STOCK
// ============================================

router.get('/stock', authenticate, checkPermission('inventario', 'read'), async (req, res) => {
  try {
    if (!req.user.branch_id) {
      return res.status(403).json({ error: 'El usuario no tiene una sucursal asignada' });
    }

    const { warehouse_id, product_id } = req.query;

    let query = supabase
      .from('stock')
      .select(`
        *,
        products!inner(id, sku, name, unit, cost_price, sale_price),
        warehouses!inner(id, name, branch_id, branches!inner(name ))
      `)
      .eq('warehouses.branch_id', req.user.branch_id)
      .gt('quantity', 0);

    if (warehouse_id) query = query.eq('warehouse_id', warehouse_id);
    if (product_id) query = query.eq('product_id', product_id);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ stock: data || [] });
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar stock' });
  }
});

// ============================================
// MOVIMIENTOS DE INVENTARIO (CU-06)
// ============================================

router.get('/movements', authenticate, checkPermission('inventario', 'read'), async (req, res) => {
  try {
    if (!req.user.branch_id) {
      return res.status(403).json({ error: 'El usuario no tiene una sucursal asignada' });
    }

    const { product_id, warehouse_id, movement_type, from_date, to_date } = req.query;

    let query = supabase
      .from('inventory_movements')
      .select(`
        *,
        products!inner(sku, name),
        warehouses!inner(name),
        users!inner(full_name)
      `)
      .eq('company_id', req.user.company_id)
      .eq('branch_id', req.user.branch_id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (product_id) query = query.eq('product_id', product_id);
    if (warehouse_id) query = query.eq('warehouse_id', warehouse_id);
    if (movement_type) query = query.eq('movement_type', movement_type);
    if (from_date) query = query.gte('created_at', from_date);
    if (to_date) query = query.lte('created_at', to_date);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ movements: data || [] });
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar movimientos' });
  }
});

// CU-06: Registrar ajuste de inventario
router.post('/adjustments', authenticate, checkPermission('inventario', 'update'), async (req, res) => {
  try {
    const { product_id, warehouse_id, movement_type, quantity, unit_cost, notes } = req.body;

    if (!product_id || !warehouse_id || !movement_type || !quantity) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    const branchValidationError = await validateBranchProductAndWarehouse(
      req,
      product_id,
      warehouse_id
    );
    if (branchValidationError) {
      return res.status(400).json({ error: branchValidationError });
    }

    const validTypes = ['entrada', 'salida', 'ajuste_positivo', 'ajuste_negativo'];
    if (!validTypes.includes(movement_type)) {
      return res.status(400).json({ error: 'Tipo de movimiento inválido' });
    }

    const qty = parseFloat(quantity);
    const isIncrease = ['entrada', 'ajuste_positivo'].includes(movement_type);

    // Verificar stock actual
    const { data: currentStock } = await supabase
      .from('stock')
      .select('id, quantity')
      .eq('product_id', product_id)
      .eq('warehouse_id', warehouse_id)
      .single();

    if (!isIncrease && currentStock && currentStock.quantity < qty) {
      return res.status(400).json({ 
        error: `Stock insuficiente. Disponible: ${currentStock.quantity}` 
      });
    }

    // Actualizar o crear stock
    if (currentStock) {
      const newQty = isIncrease 
        ? currentStock.quantity + qty 
        : currentStock.quantity - qty;

      await supabase
        .from('stock')
        .update({ quantity: newQty, updated_at: new Date().toISOString() })
        .eq('id', currentStock.id);
    } else {
      if (!isIncrease) {
        return res.status(400).json({ error: 'No existe stock para este producto en esta bodega' });
      }

      await supabase
        .from('stock')
        .insert({
          id: uuidv4(),
          product_id,
          warehouse_id,
          quantity: qty
        });
    }

    // Registrar movimiento
    const { data: movement, error } = await supabase
      .from('inventory_movements')
      .insert({
        id: uuidv4(),
        company_id: req.user.company_id,
        branch_id: req.user.branch_id,
        product_id,
        warehouse_id,
        movement_type,
        quantity: qty,
        unit_cost: parseFloat(unit_cost) || 0,
        notes: notes || null,
        user_id: req.user.id,
        reference_type: 'ajuste_manual'
      })
      .select(`
        *,
        products!inner(sku, name),
        warehouses!inner(name)
      `)
      .single();

    if (error) throw error;

    res.status(201).json({
      message: 'Ajuste de inventario registrado',
      movement
    });
  } catch (err) {
    console.error('Error en ajuste:', err);
    res.status(500).json({ error: 'Error al registrar ajuste' });
  }
});

// ============================================
// LOTES (CU-07)
// ============================================

router.get('/batches', authenticate, checkPermission('inventario', 'read'), async (req, res) => {
  try {
    if (!req.user.branch_id) {
      return res.status(403).json({ error: 'El usuario no tiene una sucursal asignada' });
    }

    const { product_id, warehouse_id } = req.query;

    let query = supabase
      .from('batches')
      .select(`
        *,
        products!inner(sku, name),
        warehouses!inner(name)
      `)
      .eq('warehouses.branch_id', req.user.branch_id)
      .gt('quantity', 0)
      .order('expiry_date', { ascending: true, nullsFirst: false });

    if (product_id) query = query.eq('product_id', product_id);
    if (warehouse_id) query = query.eq('warehouse_id', warehouse_id);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ batches: data || [] });
  } catch (err) {
    res.status(500).json({ error: 'Error al listar lotes' });
  }
});

router.post('/batches', authenticate, checkPermission('inventario', 'create'), async (req, res) => {
  try {
    const { product_id, warehouse_id, batch_number, serial_number, expiry_date, quantity, cost_price } = req.body;

    if (!product_id || !warehouse_id || !quantity) {
      return res.status(400).json({ error: 'Producto, bodega y cantidad son requeridos' });
    }

    const branchValidationError = await validateBranchProductAndWarehouse(
      req,
      product_id,
      warehouse_id
    );
    if (branchValidationError) {
      return res.status(400).json({ error: branchValidationError });
    }

    const { data, error } = await supabase
      .from('batches')
      .insert({
        id: uuidv4(),
        product_id,
        warehouse_id,
        batch_number: batch_number || null,
        serial_number: serial_number || null,
        expiry_date: expiry_date || null,
        quantity: parseFloat(quantity),
        cost_price: parseFloat(cost_price) || 0
      })
      .select(`
        *,
        products!inner(sku, name),
        warehouses!inner(name)
      `)
      .single();

    if (error) throw error;

    // Actualizar stock
    const { data: currentStock } = await supabase
      .from('stock')
      .select('id, quantity')
      .eq('product_id', product_id)
      .eq('warehouse_id', warehouse_id)
      .single();

    if (currentStock) {
      await supabase
        .from('stock')
        .update({ 
          quantity: currentStock.quantity + parseFloat(quantity),
          updated_at: new Date().toISOString()
        })
        .eq('id', currentStock.id);
    } else {
      await supabase
        .from('stock')
        .insert({
          id: uuidv4(),
          product_id,
          warehouse_id,
          quantity: parseFloat(quantity)
        });
    }

    // Registrar movimiento
    await supabase
      .from('inventory_movements')
      .insert({
        id: uuidv4(),
        company_id: req.user.company_id,
        branch_id: req.user.branch_id,
        product_id,
        warehouse_id,
        batch_id: data.id,
        movement_type: 'entrada',
        quantity: parseFloat(quantity),
        unit_cost: parseFloat(cost_price) || 0,
        notes: `Lote: ${batch_number || 'S/N'}`,
        user_id: req.user.id,
        reference_type: 'lote'
      });

    res.status(201).json({ message: 'Lote creado', batch: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al crear lote' });
  }
});

export default router;