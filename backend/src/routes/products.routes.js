import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../config/supabase.js';
import { authenticate, checkPermission } from '../middleware/auth.js';

const router = Router();

async function categoryBelongsToBranch(categoryId, user) {
  if (!categoryId) return true;

  const { data, error } = await supabase
    .from('categories')
    .select('id')
    .eq('id', categoryId)
    .eq('company_id', user.company_id)
    .eq('branch_id', user.branch_id)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

// CU-04/05: Listar productos
router.get('/', authenticate, checkPermission('productos', 'read'), async (req, res) => {
  try {
    if (!req.user.branch_id) {
      return res.status(403).json({ error: 'El usuario no tiene una sucursal asignada' });
    }

    const { search, category_id, is_active, min_stock } = req.query;

    let query = supabase
      .from('products')
      .select(`
        id, branch_id, sku, name, description, barcode, unit,
        cost_price, sale_price, min_stock, max_stock,
        tax_rate, is_active, created_at,
        categories(id, name),
        stock(quantity, warehouse_id, warehouses(id, name, branch_id))
      `)
      .eq('company_id', req.user.company_id)
      .eq('branch_id', req.user.branch_id)
      .order('created_at', { ascending: false });

    if (search) {
      query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%,barcode.ilike.%${search}%`);
    }
    if (category_id) query = query.eq('category_id', category_id);
    if (is_active !== undefined) query = query.eq('is_active', is_active === 'true');

    const { data, error } = await query;
    if (error) throw error;

    // Mantener productos aunque todavía no tengan categoría o existencias.
    const productsMap = {};
    (data || []).forEach(p => {
      if (!productsMap[p.id]) {
        productsMap[p.id] = {
          ...p,
          total_stock: 0,
          warehouses: []
        };
        delete productsMap[p.id].stock;
      }

      const stockRows = Array.isArray(p.stock)
        ? p.stock
        : p.stock
          ? [p.stock]
          : [];

      stockRows.forEach(stock => {
        if (stock.warehouses?.branch_id !== req.user.branch_id) return;
        const stockQty = parseFloat(stock.quantity) || 0;
        productsMap[p.id].total_stock += stockQty;

        if (stock.warehouses) {
          productsMap[p.id].warehouses.push({
            warehouse_id: stock.warehouse_id,
            warehouse_name: stock.warehouses.name,
            quantity: stockQty
          });
        }
      });
    });

    let products = Object.values(productsMap);

    // Filtrar por stock mínimo
    if (min_stock === 'low') {
      products = products.filter(p => p.total_stock <= p.min_stock);
    }

    res.json({ products, total: products.length });
  } catch (err) {
    console.error('Error listando productos:', err);
    res.status(500).json({ error: 'Error al listar productos' });
  }
});

// CU-04/05: Obtener un producto
router.get('/:id', authenticate, checkPermission('productos', 'read'), async (req, res) => {
  try {
    if (!req.user.branch_id) {
      return res.status(403).json({ error: 'El usuario no tiene una sucursal asignada' });
    }

    const { data, error } = await supabase
      .from('products')
      .select(`
        *,
        categories(id, name),
        stock(id, quantity, reserved, available, warehouse_id, warehouses(id, name, branch_id))
      `)
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id)
      .eq('branch_id', req.user.branch_id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json({ product: data });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener producto' });
  }
});

// CU-04: Crear producto
router.post('/', authenticate, checkPermission('productos', 'create'), async (req, res) => {
  try {
    const {
      sku, name, description, barcode, unit,
      category_id, cost_price, sale_price,
      min_stock, max_stock, tax_rate
    } = req.body;

    if (!req.user.branch_id) {
      return res.status(403).json({ error: 'El usuario no tiene una sucursal asignada' });
    }

    if (!sku || !name) {
      return res.status(400).json({ error: 'SKU y nombre son requeridos' });
    }

    if (!(await categoryBelongsToBranch(category_id, req.user))) {
      return res.status(400).json({ error: 'La categoría no pertenece a esta sucursal' });
    }

    // Verificar SKU único
    const { data: existing, error: existingError } = await supabase
      .from('products')
      .select('id')
      .eq('company_id', req.user.company_id)
      .eq('branch_id', req.user.branch_id)
      .eq('sku', sku.toUpperCase().trim())
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing) {
      return res.status(400).json({ error: 'El SKU ya existe en esta sucursal' });
    }

    const { data, error } = await supabase
      .from('products')
      .insert({
        id: uuidv4(),
        company_id: req.user.company_id,
        branch_id: req.user.branch_id,
        sku: sku.toUpperCase().trim(),
        name,
        description: description || null,
        barcode: barcode || null,
        unit: unit || 'unidad',
        category_id: category_id || null,
        cost_price: parseFloat(cost_price) || 0,
        sale_price: parseFloat(sale_price) || 0,
        min_stock: parseFloat(min_stock) || 0,
        max_stock: parseFloat(max_stock) || 0,
        tax_rate:
          tax_rate === undefined || tax_rate === null || tax_rate === ''
            ? 15.00
            : parseFloat(tax_rate),
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      message: 'Producto creado exitosamente',
      product: data
    });
  } catch (err) {
    console.error('Error creando producto:', err);
    res.status(err.code === '23505' ? 409 : 500).json({
      error: err.code === '23505'
        ? 'El SKU o código de barras ya existe en esta sucursal'
        : 'Error al crear producto'
    });
  }
});

// CU-04: Actualizar producto
router.put('/:id', authenticate, checkPermission('productos', 'update'), async (req, res) => {
  try {
    if (!req.user.branch_id) {
      return res.status(403).json({ error: 'El usuario no tiene una sucursal asignada' });
    }

    const { data: existing } = await supabase
      .from('products')
      .select('id')
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id)
      .eq('branch_id', req.user.branch_id)
      .single();

    if (!existing) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    if (
      req.body.category_id !== undefined
      && !(await categoryBelongsToBranch(req.body.category_id, req.user))
    ) {
      return res.status(400).json({ error: 'La categoría no pertenece a esta sucursal' });
    }

    const updateData = {};
    const fields = ['name', 'description', 'barcode', 'unit', 'category_id',
                    'cost_price', 'sale_price', 'min_stock', 'max_stock', 'tax_rate', 'is_active'];
    
    fields.forEach(field => {
      if (req.body[field] !== undefined) updateData[field] = req.body[field];
    });

    const { data, error } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id)
      .eq('branch_id', req.user.branch_id)
      .select()
      .single();

    if (error) throw error;

    res.json({ message: 'Producto actualizado', product: data });
  } catch (err) {
    console.error('Error actualizando producto:', err);
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

// CU-04: Eliminar producto (soft delete)
router.delete('/:id', authenticate, checkPermission('productos', 'delete'), async (req, res) => {
  try {
    if (!req.user.branch_id) {
      return res.status(403).json({ error: 'El usuario no tiene una sucursal asignada' });
    }

    const { error } = await supabase
      .from('products')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id)
      .eq('branch_id', req.user.branch_id);

    if (error) throw error;

    res.json({ message: 'Producto desactivado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// ============================================
// CATEGORÍAS
// ============================================

router.get('/categories', authenticate, checkPermission('productos', 'read'), async (req, res) => {
  try {
    if (!req.user.branch_id) {
      return res.status(403).json({ error: 'El usuario no tiene una sucursal asignada' });
    }

    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('company_id', req.user.company_id)
      .eq('branch_id', req.user.branch_id)
      .eq('is_active', true)
      .order('name');

    if (error) throw error;

    res.json({ categories: data || [] });
  } catch (err) {
    console.error('Error listando categorías:', err);
    res.status(500).json({ error: 'Error al listar categorías' });
  }
});

router.post('/categories', authenticate, checkPermission('productos', 'create'), async (req, res) => {
  try {
    const { name, description, parent_id } = req.body;

    if (!req.user.branch_id) {
      return res.status(403).json({ error: 'El usuario no tiene una sucursal asignada' });
    }

    if (!name) {
      return res.status(400).json({ error: 'El nombre es requerido' });
    }

    if (parent_id && !(await categoryBelongsToBranch(parent_id, req.user))) {
      return res.status(400).json({ error: 'La categoría superior no pertenece a esta sucursal' });
    }

    const { data, error } = await supabase
      .from('categories')
      .insert({
        id: uuidv4(),
        company_id: req.user.company_id,
        branch_id: req.user.branch_id,
        name,
        description: description || null,
        parent_id: parent_id || null,
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ message: 'Categoría creada', category: data });
  } catch (err) {
    console.error('Error creando categoría:', err);
    res.status(500).json({ error: 'Error al crear categoría' });
  }
});

export default router;