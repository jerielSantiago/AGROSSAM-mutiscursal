import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../config/supabase.js';
import { authenticate, checkPermission } from '../middleware/auth.js';

const router = Router();

const DEFAULT_TAX_RATE = 15;
const today = () => new Date().toISOString().slice(0, 10);

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const money = (value) =>
  Math.round((number(value) + Number.EPSILON) * 100) / 100;

function calculateItem(item, defaultTaxRate = DEFAULT_TAX_RATE) {
  const quantity = number(item.quantity, NaN);
  const unitPrice = number(item.unit_price, NaN);
  const discount = number(item.discount, 0);
  const taxRate = number(item.tax_rate, defaultTaxRate);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Cada artículo debe tener una cantidad mayor que cero.');
  }

  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new Error('Cada artículo debe tener un precio válido.');
  }

  if (discount < 0) {
    throw new Error('El descuento no puede ser negativo.');
  }

  if (taxRate < 0 || taxRate > 100) {
    throw new Error('La tasa de impuesto debe estar entre 0 y 100.');
  }

  const gross = money(quantity * unitPrice);

  if (discount > gross) {
    throw new Error('El descuento de un artículo no puede superar su importe.');
  }

  const taxable = money(gross - discount);
  const taxAmount = money((taxable * taxRate) / 100);
  const lineTotal = money(taxable + taxAmount);

  return {
    quantity,
    unit_price: money(unitPrice),
    discount: money(discount),
    tax_rate: taxRate,
    tax_amount: taxAmount,
    line_total: lineTotal,
    unit: item.unit || null,
    product_id: item.product_id || null,
    description: item.description || null,
  };
}

function calculateTotals(items, documentDiscount = 0) {
  const subtotal = money(
    items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
  );

  const itemDiscounts = money(
    items.reduce((sum, item) => sum + item.discount, 0)
  );

  const taxAmount = money(
    items.reduce((sum, item) => sum + item.tax_amount, 0)
  );

  const extraDiscount = number(documentDiscount, 0);

  if (extraDiscount < 0) {
    throw new Error('El descuento de la factura no puede ser negativo.');
  }

  const discount = money(extraDiscount + itemDiscounts);

  if (discount > subtotal) {
    throw new Error('El descuento total no puede superar el subtotal.');
  }

  const total = money(subtotal - discount + taxAmount);

  return {
    subtotal,
    discount,
    tax_amount: taxAmount,
    total,
  };
}

function respondError(res, err, fallback) {
  console.error(fallback, err);

  return res.status(500).json({
    error: fallback,
    detail: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
}

async function getNextNumber(
  table,
  column,
  prefix,
  branchId,
  companyId,
  seriesColumn = null
) {
  let query = supabase
    .from(table)
    .select(column)
    .eq('company_id', companyId)
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (seriesColumn) {
    query = query.eq(seriesColumn, prefix);
  }

  const { data, error } = await query;

  if (error) throw error;

  const lastValue = data?.[0]?.[column];
  let next = 1;

  if (lastValue) {
    const numericPart = String(lastValue).split('-').at(-1);
    next = (parseInt(numericPart, 10) || 0) + 1;
  }

  return `${prefix}-${String(next).padStart(8, '0')}`;
}

async function getActiveProducts(productIds, companyId, branchId) {
  const ids = [...new Set(productIds.filter(Boolean))];

  if (!ids.length) return new Map();

  const { data, error } = await supabase
    .from('products')
    .select(
      'id, company_id, branch_id, name, unit, cost_price, sale_price, tax_rate, is_active'
    )
    .eq('company_id', companyId)
    .eq('branch_id', branchId)
    .in('id', ids)
    .eq('is_active', true);

  if (error) throw error;

  const products = new Map((data || []).map((product) => [product.id, product]));

  for (const id of ids) {
    if (!products.has(id)) {
      throw new Error(
        'Uno de los productos no existe, está inactivo o no pertenece a esta sucursal.'
      );
    }
  }

  return products;
}

async function insertInvoiceItems(invoiceId, items, products) {
  const rows = items.map((item) => {
    const product = item.product_id
      ? products.get(item.product_id)
      : null;

    return {
      id: uuidv4(),
      invoice_id: invoiceId,
      product_id: item.product_id || null,
      description: item.description || product?.name || 'Artículo',
      quantity: item.quantity,
      unit: item.unit || product?.unit || null,
      unit_price: item.unit_price,
      discount: item.discount,
      tax_rate: item.tax_rate,
      tax_amount: item.tax_amount,
      line_total: item.line_total,
    };
  });

  const { data, error } = await supabase
    .from('invoice_items')
    .insert(rows)
    .select();

  if (error) throw error;

  return data || [];
}

async function insertQuoteItems(quoteId, items, products) {
  const rows = items.map((item) => {
    const product = item.product_id
      ? products.get(item.product_id)
      : null;

    return {
      id: uuidv4(),
      quote_id: quoteId,
      product_id: item.product_id || null,
      description: item.description || product?.name || 'Artículo',
      quantity: item.quantity,
      unit: item.unit || product?.unit || null,
      unit_price: item.unit_price,
      discount: item.discount,
      tax_rate: item.tax_rate,
      tax_amount: item.tax_amount,
      line_total: item.line_total,
    };
  });

  const { data, error } = await supabase
    .from('quote_items')
    .insert(rows)
    .select();

  if (error) throw error;

  return data || [];
}

/**
 * Descuenta o repone existencias.
 * Las llamadas REST a Supabase no forman una única transacción.
 */
async function changeStockAndLog({
  items,
  invoice,
  req,
  direction,
  referenceType,
  notePrefix,
}) {
  for (const item of items) {
    if (!item.product_id || !item.warehouse_id) continue;

    const quantity = number(item.quantity);

    const { data: warehouse, error: warehouseError } = await supabase
      .from('warehouses')
      .select('id, branch_id, is_active')
      .eq('id', item.warehouse_id)
      .single();

    if (
      warehouseError ||
      !warehouse ||
      warehouse.branch_id !== req.user.branch_id ||
      warehouse.is_active === false
    ) {
      throw new Error(
        'El almacén indicado no existe, no está activo o no pertenece a la sucursal del usuario.'
      );
    }

    const { data: stock, error: stockError } = await supabase
      .from('stock')
      .select('id, quantity, reserved')
      .eq('product_id', item.product_id)
      .eq('warehouse_id', item.warehouse_id)
      .maybeSingle();

    if (stockError) throw stockError;

    if (direction === 'out') {
      if (!stock || number(stock.quantity) - number(stock.reserved) < quantity) {
        throw new Error(
          'No hay existencias disponibles suficientes para uno de los productos.'
        );
      }

      const newQuantity = money(number(stock.quantity) - quantity);

      const { error: updateError } = await supabase
        .from('stock')
        .update({
          quantity: newQuantity,
          available: money(newQuantity - number(stock.reserved)),
          updated_at: new Date().toISOString(),
        })
        .eq('id', stock.id);

      if (updateError) throw updateError;
    } else {
      if (!stock) {
        throw new Error(
          'No se encontró el registro de existencias para reponer un producto.'
        );
      }

      const newQuantity = money(number(stock.quantity) + quantity);

      const { error: updateError } = await supabase
        .from('stock')
        .update({
          quantity: newQuantity,
          available: money(newQuantity - number(stock.reserved)),
          updated_at: new Date().toISOString(),
        })
        .eq('id', stock.id);

      if (updateError) throw updateError;
    }

    const { error: movementError } = await supabase
      .from('inventory_movements')
      .insert({
        id: uuidv4(),
        company_id: req.user.company_id,
        branch_id: req.user.branch_id,
        product_id: item.product_id,
        warehouse_id: item.warehouse_id,
        movement_type: direction === 'out' ? 'salida' : 'entrada',
        quantity,
        unit_cost: number(item.unit_price),
        reference_type: referenceType,
        reference_id: invoice.id,
        notes: `${notePrefix}: ${invoice.invoice_number}`,
        user_id: req.user.id,
      });

    if (movementError) throw movementError;
  }
}

// ============================================
// FACTURAS
// ============================================

router.get(
  '/dashboard',
  authenticate,
  checkPermission('facturas', 'read'),
  async (req, res) => {
    try {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
        .toISOString()
        .slice(0, 10);
      const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
        .toISOString()
        .slice(0, 10);

      let invoicesQuery = supabase
        .from('invoices')
        .select('id, total')
        .eq('company_id', req.user.company_id)
        .eq('status', 'emitida')
        .gte('issue_date', monthStart)
        .lt('issue_date', nextMonthStart);

      if (req.user.branch_id) {
        invoicesQuery = invoicesQuery.eq('branch_id', req.user.branch_id);
      }

      const { data: invoices, error: invoicesError } = await invoicesQuery;
      if (invoicesError) throw invoicesError;

      const invoiceIds = (invoices || []).map(invoice => invoice.id);
      let items = [];

      if (invoiceIds.length) {
        const { data, error } = await supabase
          .from('invoice_items')
          .select('product_id, description, quantity, line_total')
          .in('invoice_id', invoiceIds);
        if (error) throw error;
        items = data || [];
      }

      const productTotals = new Map();
      for (const item of items) {
        const name = item.description || 'Producto sin nombre';
        const key = item.product_id || name.toLocaleLowerCase();
        const current = productTotals.get(key) || {
          product_id: item.product_id || null,
          name,
          quantity_sold: 0,
          sales_amount: 0,
        };
        current.quantity_sold += number(item.quantity);
        current.sales_amount += number(item.line_total);
        productTotals.set(key, current);
      }

      const topProducts = [...productTotals.values()]
        .sort((a, b) => b.quantity_sold - a.quantity_sold)
        .slice(0, 3)
        .map(product => ({
          ...product,
          quantity_sold: money(product.quantity_sold),
          sales_amount: money(product.sales_amount),
        }));
      const salesTotal = money(
        (invoices || []).reduce((sum, invoice) => sum + number(invoice.total), 0)
      );

      res.json({
        period: { from: monthStart, to: new Date().toISOString().slice(0, 10) },
        summary: {
          sales_total: salesTotal,
          invoice_count: invoices?.length || 0,
          average_sale: invoices?.length ? money(salesTotal / invoices.length) : 0,
          units_sold: money(items.reduce((sum, item) => sum + number(item.quantity), 0)),
        },
        top_products: topProducts,
      });
    } catch (err) {
      return respondError(res, err, 'Error al cargar el resumen del dashboard');
    }
  }
);

router.get(
  '/reports',
  authenticate,
  checkPermission('facturas', 'read'),
  async (req, res) => {
    try {
      const { from_date, to_date } = req.query;
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      const isValidDate = value => {
        if (typeof value !== 'string' || !datePattern.test(value)) return false;
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return Number.isFinite(parsed.getTime())
          && parsed.toISOString().slice(0, 10) === value;
      };

      if (
        (from_date && !isValidDate(from_date)) ||
        (to_date && !isValidDate(to_date)) ||
        (from_date && to_date && from_date > to_date)
      ) {
        return res.status(400).json({ error: 'El rango de fechas no es válido.' });
      }

      let query = supabase
        .from('invoices')
        .select(`
          id, invoice_number, issue_date, status, payment_status,
          total, amount_paid, balance_due,
          contacts(name),
          invoice_items(product_id, description, quantity, line_total)
        `)
        .eq('company_id', req.user.company_id)
        .in('status', ['emitida', 'pagada', 'parcial', 'vencida'])
        .order('issue_date', { ascending: true });

      if (req.user.branch_id) {
        query = query.eq('branch_id', req.user.branch_id);
      }
      if (from_date) query = query.gte('issue_date', from_date);
      if (to_date) query = query.lte('issue_date', to_date);

      const { data, error } = await query;
      if (error) throw error;

      const invoices = data || [];
      const dailyTotals = new Map();
      const productTotals = new Map();

      for (const invoice of invoices) {
        const day = invoice.issue_date;
        dailyTotals.set(day, money(
          (dailyTotals.get(day) || 0) + number(invoice.total)
        ));

        for (const item of invoice.invoice_items || []) {
          const label = item.description || 'Producto sin nombre';
          const key = item.product_id || label.toLocaleLowerCase();
          const current = productTotals.get(key) || {
            name: label,
            quantity_sold: 0,
            sales_amount: 0,
          };
          current.quantity_sold += number(item.quantity);
          current.sales_amount += number(item.line_total);
          productTotals.set(key, current);
        }
      }

      const salesTotal = money(
        invoices.reduce((sum, invoice) => sum + number(invoice.total), 0)
      );

      return res.json({
        period: { from: from_date || null, to: to_date || null },
        summary: {
          sales_total: salesTotal,
          invoice_count: invoices.length,
          average_sale: invoices.length ? money(salesTotal / invoices.length) : 0,
          receivable_total: money(
            invoices.reduce((sum, invoice) => sum + number(invoice.balance_due), 0)
          ),
        },
        daily_sales: [...dailyTotals.entries()].map(([date, total]) => ({ date, total })),
        top_products: [...productTotals.values()]
          .sort((a, b) => b.quantity_sold - a.quantity_sold)
          .slice(0, 10)
          .map(product => ({
            ...product,
            quantity_sold: money(product.quantity_sold),
            sales_amount: money(product.sales_amount),
          })),
      });
    } catch (err) {
      return respondError(res, err, 'Error al cargar los reportes');
    }
  }
);

// Listar facturas
router.get(
  '/invoices',
  authenticate,
  checkPermission('facturas', 'read'),
  async (req, res) => {
    try {
  console.log('🔎 Datos del usuario al listar facturas:', {
    id: req.user?.id,
    company_id: req.user?.company_id,
    branch_id: req.user?.branch_id,
    role: req.user?.role
  });

  const { status, search, from_date, to_date } = req.query;

      

      let query = supabase
        .from('invoices')
        .select(`
          *,
          contacts(id, name, document_number),
          users!invoices_user_id_fkey(id, full_name)
        `)
        .eq('company_id', req.user.company_id)
        .order('created_at', { ascending: false });

      if (req.user.branch_id) {
        query = query.eq('branch_id', req.user.branch_id);
      }

      if (status) query = query.eq('status', status);
      if (from_date) query = query.gte('issue_date', from_date);
      if (to_date) query = query.lte('issue_date', to_date);

      const { data, error } = await query;

      console.log('🔎 Error al consultar facturas:', error);
      console.log('🔎 Cantidad de facturas encontradas:', data?.length);
      console.log('🔎 Facturas devueltas:', data);

      if (error) throw error;

      let invoices = data || [];

      if (search) {
        const term = String(search).toLocaleLowerCase();

        invoices = invoices.filter((invoice) =>
          String(invoice.invoice_number || '')
            .toLocaleLowerCase()
            .includes(term) ||
          String(invoice.contacts?.name || '')
            .toLocaleLowerCase()
            .includes(term) ||
          String(invoice.contacts?.document_number || '')
            .toLocaleLowerCase()
            .includes(term)
        );
      }

      const stats = {
        total: invoices.length,
        total_amount: money(
          invoices.reduce((sum, invoice) => sum + number(invoice.total), 0)
        ),
        pending_amount: money(
          invoices.reduce(
            (sum, invoice) => sum + number(invoice.balance_due),
            0
          )
        ),
      };

      return res.json({ invoices, stats });
    } catch (err) {
      return respondError(res, err, 'Error al listar facturas');
    }
  }
);

// Obtener una factura
router.get(
  '/invoices/:id',
  authenticate,
  checkPermission('facturas', 'read'),
  async (req, res) => {
    try {
      let query = supabase
        .from('invoices')
        .select(`
          *,
          contacts(*),
          companies(*),
          users!invoices_user_id_fkey(id, full_name),
          invoice_items(*),
          warehouses(id, name)
        `)
        .eq('id', req.params.id)
        .eq('company_id', req.user.company_id);

      if (req.user.branch_id) {
        query = query.eq('branch_id', req.user.branch_id);
      }

      const { data, error } = await query.single();

      console.log('🔎 Detalle de factura solicitado:', req.params.id);
      console.log('🔎 Error al consultar detalle:', error);
      console.log('🔎 Factura encontrada:', data);

      if (error || !data) {
        return res.status(404).json({ error: 'Factura no encontrada.' });
      }

      return res.json({ invoice: data });
    } catch (err) {
      return respondError(res, err, 'Error al obtener factura');
    }
  }
);

// Crear factura
router.post(
  '/invoices',
  authenticate,
  checkPermission('facturas', 'create'),
  async (req, res) => {
    try {
      const {
        contact_id,
        warehouse_id,
        issue_date,
        due_date,
        notes,
        items,
        discount = 0,
        status = 'borrador',
      } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          error: 'La factura debe contener al menos un artículo.',
        });
      }

      const validStatuses = ['borrador', 'emitida'];

      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          error: 'El estado inicial debe ser borrador o emitida.',
        });
      }

      const normalizedItems = items.map((item) => calculateItem(item));

      const products = await getActiveProducts(
        normalizedItems.map((item) => item.product_id),
        req.user.company_id,
        req.user.branch_id
      );

      normalizedItems.forEach((item, index) => {
        const product = item.product_id
          ? products.get(item.product_id)
          : null;

        if (product) {
          if (!item.unit) item.unit = product.unit || null;
          if (!item.description) item.description = product.name;

          const originalTax = items[index].tax_rate;

          if (
            originalTax === undefined ||
            originalTax === null ||
            originalTax === ''
          ) {
            Object.assign(
              item,
              calculateItem({
                ...items[index],
                ...item,
                tax_rate: number(product.tax_rate, DEFAULT_TAX_RATE),
              })
            );
          }
        }
      });

      const totals = calculateTotals(normalizedItems, discount);

      const invoiceNumber = await getNextNumber(
        'invoices',
        'invoice_number',
        'FAC',
        req.user.branch_id,
        req.user.company_id
      );

      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
          id: uuidv4(),
          company_id: req.user.company_id,
          branch_id: req.user.branch_id,
          contact_id: contact_id || null,
          user_id: req.user.id,
          warehouse_id: warehouse_id || null,
          invoice_number: invoiceNumber,
          series: 'F001',
          issue_date: issue_date || today(),
          due_date: due_date || null,
          status,
          payment_status: 'pendiente',
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax_amount: totals.tax_amount,
          total: totals.total,
          amount_paid: 0,
          balance_due: totals.total,
          currency: 'NIO',
          notes: notes || null,
        })
        .select()
        .single();

      if (invoiceError) throw invoiceError;

      await insertInvoiceItems(invoice.id, normalizedItems, products);

      if (status === 'emitida' && warehouse_id) {
        await changeStockAndLog({
          items: normalizedItems.map((item) => ({
            ...item,
            warehouse_id,
          })),
          invoice,
          req,
          direction: 'out',
          referenceType: 'factura',
          notePrefix: 'Venta',
        });
      }

      return res.status(201).json({
        message: 'Factura creada correctamente.',
        invoice,
      });
    } catch (err) {
      return respondError(res, err, 'Error al crear factura');
    }
  }
);

// Actualizar estado de factura
router.patch(
  '/invoices/:id/status',
  authenticate,
  checkPermission('facturas', 'update'),
  async (req, res) => {
    try {
      const { status } = req.body;
      const allowedStatuses = ['borrador', 'emitida', 'anulada'];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: 'Estado de factura no válido.' });
      }

      let query = supabase
        .from('invoices')
        .select('*')
        .eq('id', req.params.id)
        .eq('company_id', req.user.company_id);

      if (req.user.branch_id) {
        query = query.eq('branch_id', req.user.branch_id);
      }

      const { data: invoice, error: findError } = await query.single();

      if (findError || !invoice) {
        return res.status(404).json({ error: 'Factura no encontrada.' });
      }

      if (invoice.status === 'anulada') {
        return res.status(400).json({
          error: 'No se puede modificar una factura anulada.',
        });
      }

      if (invoice.status === status) {
        return res.json({
          message: 'La factura ya tiene ese estado.',
          invoice,
        });
      }

      if (status === 'emitida' && invoice.status === 'borrador') {
        const { data: items, error: itemsError } = await supabase
          .from('invoice_items')
          .select('*')
          .eq('invoice_id', invoice.id);

        if (itemsError) throw itemsError;

        if (invoice.warehouse_id) {
          await changeStockAndLog({
            items: (items || []).map((item) => ({
              ...item,
              warehouse_id: invoice.warehouse_id,
            })),
            invoice,
            req,
            direction: 'out',
            referenceType: 'factura',
            notePrefix: 'Venta',
          });
        }
      }

      if (status === 'anulada' && invoice.status === 'emitida') {
        const { data: items, error: itemsError } = await supabase
          .from('invoice_items')
          .select('*')
          .eq('invoice_id', invoice.id);

        if (itemsError) throw itemsError;

        if (invoice.warehouse_id) {
          await changeStockAndLog({
            items: (items || []).map((item) => ({
              ...item,
              warehouse_id: invoice.warehouse_id,
            })),
            invoice,
            req,
            direction: 'in',
            referenceType: 'anulacion_factura',
            notePrefix: 'Anulación de venta',
          });
        }
      }

      const updateFields = { status };

      if (status === 'anulada') {
        updateFields.payment_status = 'anulado';
      }

      const { data: updated, error: updateError } = await supabase
        .from('invoices')
        .update(updateFields)
        .eq('id', invoice.id)
        .eq('company_id', req.user.company_id)
        .select()
        .single();

      if (updateError) throw updateError;

      return res.json({
        message: 'Estado de factura actualizado.',
        invoice: updated,
      });
    } catch (err) {
      return respondError(res, err, 'Error al actualizar estado de factura');
    }
  }
);

// Registrar pago de factura
router.post(
  '/invoices/:id/payments',
  authenticate,
  checkPermission('facturas', 'update'),
  async (req, res) => {
    try {
      const { amount } = req.body;
      const paymentAmount = number(amount, NaN);

      if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
        return res.status(400).json({
          error: 'El monto del pago debe ser mayor que cero.',
        });
      }

      let query = supabase
        .from('invoices')
        .select('*')
        .eq('id', req.params.id)
        .eq('company_id', req.user.company_id);

      if (req.user.branch_id) {
        query = query.eq('branch_id', req.user.branch_id);
      }

      const { data: invoice, error: invoiceError } = await query.single();

      if (invoiceError || !invoice) {
        return res.status(404).json({ error: 'Factura no encontrada.' });
      }

      if (['anulada', 'borrador'].includes(invoice.status)) {
        return res.status(400).json({
          error: 'Solo se pueden registrar pagos de facturas emitidas.',
        });
      }

      const balance = number(invoice.balance_due);

      if (paymentAmount > balance) {
        return res.status(400).json({
          error: 'El pago no puede superar el saldo pendiente.',
        });
      }

      const amountPaid = money(number(invoice.amount_paid) + paymentAmount);
      const balanceDue = money(Math.max(0, balance - paymentAmount));
      const paymentStatus = balanceDue === 0 ? 'pagado' : 'parcial';
      const invoiceStatus = balanceDue === 0 ? 'pagada' : 'parcial';

      const { data: updated, error: updateError } = await supabase
        .from('invoices')
        .update({
          amount_paid: amountPaid,
          balance_due: balanceDue,
          payment_status: paymentStatus,
          status: invoiceStatus,
        })
        .eq('id', invoice.id)
        .eq('company_id', req.user.company_id)
        .select()
        .single();

      if (updateError) throw updateError;

      if (invoice.contact_id) {
        const { data: contact, error: contactError } = await supabase
          .from('contacts')
          .select('balance')
          .eq('id', invoice.contact_id)
          .eq('company_id', req.user.company_id)
          .single();

        if (contactError) throw contactError;

        const newContactBalance = money(
          Math.max(0, number(contact.balance) - paymentAmount)
        );

        const { error: contactUpdateError } = await supabase
          .from('contacts')
          .update({ balance: newContactBalance })
          .eq('id', invoice.contact_id)
          .eq('company_id', req.user.company_id);

        if (contactUpdateError) throw contactUpdateError;
      }

      return res.json({
        message: 'Pago registrado correctamente.',
        invoice: updated,
      });
    } catch (err) {
      return respondError(res, err, 'Error al registrar pago');
    }
  }
);

// ============================================
// COTIZACIONES
// ============================================

router.get(
  '/quotes',
  authenticate,
  checkPermission('ventas', 'read'),
  async (req, res) => {
    try {
      const { status, search } = req.query;

      let query = supabase
        .from('quotes')
        .select(`
          *,
          contacts(id, name, document_number),
          users!quotes_user_id_fkey(id, full_name),
          quote_items(*)
        `)
        .eq('company_id', req.user.company_id)
        .order('created_at', { ascending: false });

      if (req.user.branch_id) {
        query = query.eq('branch_id', req.user.branch_id);
      }

      if (status) query = query.eq('status', status);

      const { data, error } = await query;

      
      if (error) throw error;

      let quotes = data || [];

      if (search) {
        const term = String(search).toLocaleLowerCase();

        quotes = quotes.filter((quote) =>
          String(quote.quote_number || '')
            .toLocaleLowerCase()
            .includes(term) ||
          String(quote.contacts?.name || '')
            .toLocaleLowerCase()
            .includes(term)
        );
      }

      return res.json({ quotes });
    } catch (err) {
      return respondError(res, err, 'Error al listar cotizaciones');
    }
  }
);

router.get(
  '/quotes/:id',
  authenticate,
  checkPermission('ventas', 'read'),
  async (req, res) => {
    try {
      let query = supabase
        .from('quotes')
        .select(`
          *,
          contacts(*),
          users!quotes_user_id_fkey(id, full_name),
          quote_items(*)
        `)
        .eq('id', req.params.id)
        .eq('company_id', req.user.company_id);

      if (req.user.branch_id) {
        query = query.eq('branch_id', req.user.branch_id);
      }

      const { data, error } = await query.single();

      if (error || !data) {
        return res.status(404).json({ error: 'Cotización no encontrada.' });
      }

      return res.json({ quote: data });
    } catch (err) {
      return respondError(res, err, 'Error al obtener cotización');
    }
  }
);

router.post(
  '/quotes',
  authenticate,
  checkPermission('ventas', 'create'),
  async (req, res) => {
    try {
      const {
        contact_id,
        issue_date,
        expiration_date,
        notes,
        terms,
        items,
        discount = 0,
      } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          error: 'La cotización debe contener al menos un artículo.',
        });
      }

      const normalizedItems = items.map((item) => calculateItem(item));

      const products = await getActiveProducts(
        normalizedItems.map((item) => item.product_id),
        req.user.company_id,
        req.user.branch_id
      );

      normalizedItems.forEach((item, index) => {
        const product = item.product_id
          ? products.get(item.product_id)
          : null;

        if (product) {
          if (!item.unit) item.unit = product.unit || null;
          if (!item.description) item.description = product.name;

          const originalTax = items[index].tax_rate;

          if (
            originalTax === undefined ||
            originalTax === null ||
            originalTax === ''
          ) {
            Object.assign(
              item,
              calculateItem({
                ...items[index],
                ...item,
                tax_rate: number(product.tax_rate, DEFAULT_TAX_RATE),
              })
            );
          }
        }
      });

      const totals = calculateTotals(normalizedItems, discount);

      const quoteNumber = await getNextNumber(
        'quotes',
        'quote_number',
        'COT',
        req.user.branch_id,
        req.user.company_id
      );

      const { data: quote, error: quoteError } = await supabase
        .from('quotes')
        .insert({
          id: uuidv4(),
          company_id: req.user.company_id,
          branch_id: req.user.branch_id,
          contact_id: contact_id || null,
          user_id: req.user.id,
          quote_number: quoteNumber,
          issue_date: issue_date || today(),
          expiration_date: expiration_date || null,
          status: 'borrador',
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax_amount: totals.tax_amount,
          total: totals.total,
          currency: 'NIO',
          notes: notes || null,
          terms: terms || null,
        })
        .select()
        .single();

      if (quoteError) throw quoteError;

      await insertQuoteItems(quote.id, normalizedItems, products);

      return res.status(201).json({
        message: 'Cotización creada correctamente.',
        quote,
      });
    } catch (err) {
      return respondError(res, err, 'Error al crear cotización');
    }
  }
);

// Actualizar estado de cotización
router.patch(
  '/quotes/:id/status',
  authenticate,
  checkPermission('ventas', 'update'),
  async (req, res) => {
    try {
      const { status } = req.body;
      const allowedStatuses = [
        'borrador',
        'enviada',
        'aceptada',
        'rechazada',
        'vencida',
      ];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          error: 'Estado de cotización no válido.',
        });
      }

      let query = supabase
        .from('quotes')
        .select('*')
        .eq('id', req.params.id)
        .eq('company_id', req.user.company_id);

      if (req.user.branch_id) {
        query = query.eq('branch_id', req.user.branch_id);
      }

      const { data: quote, error: findError } = await query.single();

      if (findError || !quote) {
        return res.status(404).json({ error: 'Cotización no encontrada.' });
      }

      if (quote.status === 'convertida') {
        return res.status(400).json({
          error: 'La cotización ya fue convertida en factura.',
        });
      }

      const { data: updated, error: updateError } = await supabase
        .from('quotes')
        .update({ status })
        .eq('id', quote.id)
        .eq('company_id', req.user.company_id)
        .select()
        .single();

      if (updateError) throw updateError;

      return res.json({
        message: 'Estado de cotización actualizado.',
        quote: updated,
      });
    } catch (err) {
      return respondError(res, err, 'Error al actualizar cotización');
    }
  }
);

// Convertir cotización en factura
router.post(
  '/quotes/:id/convert',
  authenticate,
  checkPermission('ventas', 'create'),
  async (req, res) => {
    try {
      let quoteQuery = supabase
        .from('quotes')
        .select('*, quote_items(*)')
        .eq('id', req.params.id)
        .eq('company_id', req.user.company_id);

      if (req.user.branch_id) {
        quoteQuery = quoteQuery.eq('branch_id', req.user.branch_id);
      }

      const { data: quote, error: quoteError } = await quoteQuery.single();

      if (quoteError || !quote) {
        return res.status(404).json({ error: 'Cotización no encontrada.' });
      }

      if (quote.status === 'convertida') {
        return res.status(400).json({
          error: 'Esta cotización ya fue convertida.',
        });
      }

      if (!quote.quote_items?.length) {
        return res.status(400).json({
          error: 'La cotización no contiene artículos.',
        });
      }

      const invoiceNumber = await getNextNumber(
        'invoices',
        'invoice_number',
        'FAC',
        req.user.branch_id,
        req.user.company_id
      );

      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
          id: uuidv4(),
          company_id: req.user.company_id,
          branch_id: req.user.branch_id,
          contact_id: quote.contact_id || null,
          user_id: req.user.id,
          invoice_number: invoiceNumber,
          series: 'F001',
          issue_date: today(),
          status: 'borrador',
          payment_status: 'pendiente',
          subtotal: quote.subtotal,
          discount: quote.discount,
          tax_amount: quote.tax_amount,
          total: quote.total,
          amount_paid: 0,
          balance_due: quote.total,
          currency: quote.currency || 'NIO',
          notes: quote.notes || null,
        })
        .select()
        .single();

      if (invoiceError) throw invoiceError;

      const invoiceItems = quote.quote_items.map((item) => ({
        id: uuidv4(),
        invoice_id: invoice.id,
        product_id: item.product_id || null,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit || null,
        unit_price: item.unit_price,
        discount: item.discount,
        tax_rate: item.tax_rate,
        tax_amount: item.tax_amount,
        line_total: item.line_total,
      }));

      const { error: insertItemsError } = await supabase
        .from('invoice_items')
        .insert(invoiceItems);

      if (insertItemsError) throw insertItemsError;

      const { error: updateQuoteError } = await supabase
        .from('quotes')
        .update({
          status: 'convertida',
          converted_to_invoice_id: invoice.id,
        })
        .eq('id', quote.id)
        .eq('company_id', req.user.company_id);

      if (updateQuoteError) throw updateQuoteError;

      return res.status(201).json({
        message: 'Cotización convertida en factura.',
        invoice,
      });
    } catch (err) {
      return respondError(res, err, 'Error al convertir cotización');
    }
  }
);

// ============================================
// NOTAS DE CRÉDITO
// ============================================

router.get(
  '/credit-notes',
  authenticate,
  checkPermission('facturas', 'read'),
  async (req, res) => {
    try {
      let query = supabase
        .from('credit_notes')
        .select(`
          *,
          invoices(invoice_number, total, balance_due),
          contacts(name, document_number),
          users!credit_notes_user_id_fkey(id, full_name)
        `)
        .eq('company_id', req.user.company_id)
        .order('created_at', { ascending: false });

      if (req.user.branch_id) {
        query = query.eq('branch_id', req.user.branch_id);
      }

      const { data, error } = await query;

      if (error) throw error;

      return res.json({ credit_notes: data || [] });
    } catch (err) {
      return respondError(res, err, 'Error al listar notas de crédito');
    }
  }
);

router.post(
  '/credit-notes',
  authenticate,
  checkPermission('facturas', 'create'),
  async (req, res) => {
    try {
      const { invoice_id, reason, items } = req.body;

      if (
        !invoice_id ||
        !Array.isArray(items) ||
        items.length === 0 ||
        !reason
      ) {
        return res.status(400).json({
          error: 'Factura, motivo y artículos son requeridos.',
        });
      }

      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', invoice_id)
        .eq('company_id', req.user.company_id)
        .eq('branch_id', req.user.branch_id)
        .single();

      if (invoiceError || !invoice) {
        return res.status(404).json({ error: 'Factura no encontrada.' });
      }

      if (invoice.status === 'anulada') {
        return res.status(400).json({
          error:
            'No se puede emitir una nota de crédito para una factura anulada.',
        });
      }

      const normalizedItems = items.map((item) => calculateItem(item));
      const totals = calculateTotals(normalizedItems, 0);
      const creditTotal = totals.total;

      if (creditTotal > number(invoice.total)) {
        return res.status(400).json({
          error: 'La nota de crédito no puede superar el total de la factura.',
        });
      }

      const creditNoteNumber = await getNextNumber(
        'credit_notes',
        'credit_note_number',
        'NC',
        req.user.branch_id,
        req.user.company_id
      );

      const { data: creditNote, error } = await supabase
        .from('credit_notes')
        .insert({
          id: uuidv4(),
          company_id: req.user.company_id,
          branch_id: req.user.branch_id,
          invoice_id,
          contact_id: invoice.contact_id || null,
          user_id: req.user.id,
          credit_note_number: creditNoteNumber,
          issue_date: today(),
          reason: String(reason).trim(),
          status: 'borrador',
          subtotal: totals.subtotal,
          tax_amount: totals.tax_amount,
          total: creditTotal,
          currency: invoice.currency || 'NIO',
        })
        .select()
        .single();

      if (error) throw error;

      // La tabla credit_notes no tiene una tabla de detalle.
      // Los artículos se utilizan para calcular el importe de la nota.

      if (invoice.contact_id && number(invoice.balance_due) > 0) {
        const reduction = Math.min(
          creditTotal,
          number(invoice.balance_due)
        );

        const newBalance = money(
          Math.max(0, number(invoice.balance_due) - reduction)
        );

        const newPaid = money(number(invoice.amount_paid));
        const newStatus =
          newBalance === 0
            ? 'pagada'
            : newPaid > 0
              ? 'parcial'
              : 'emitida';

        const newPaymentStatus =
          newBalance === 0
            ? 'pagado'
            : newPaid > 0
              ? 'parcial'
              : 'pendiente';

        const { error: invoiceUpdateError } = await supabase
          .from('invoices')
          .update({
            balance_due: newBalance,
            status: newStatus,
            payment_status: newPaymentStatus,
          })
          .eq('id', invoice.id)
          .eq('company_id', req.user.company_id);

        if (invoiceUpdateError) throw invoiceUpdateError;

        const { data: contact, error: contactError } = await supabase
          .from('contacts')
          .select('balance')
          .eq('id', invoice.contact_id)
          .eq('company_id', req.user.company_id)
          .single();

        if (contactError) throw contactError;

        const { error: contactUpdateError } = await supabase
          .from('contacts')
          .update({
            balance: money(
              Math.max(0, number(contact.balance) - reduction)
            ),
          })
          .eq('id', invoice.contact_id)
          .eq('company_id', req.user.company_id);

        if (contactUpdateError) throw contactUpdateError;
      }

      return res.status(201).json({
        message: 'Nota de crédito creada como borrador.',
        credit_note: creditNote,
        warning:
          'El esquema actual no tiene una tabla de detalle para guardar los artículos de la nota de crédito.',
      });
    } catch (err) {
      return respondError(res, err, 'Error al crear nota de crédito');
    }
  }
);

// ============================================
// NOTAS DE ENTREGA
// ============================================

router.get(
  '/delivery-notes',
  authenticate,
  checkPermission('ventas', 'read'),
  async (req, res) => {
    try {
      let query = supabase
        .from('delivery_notes')
        .select(`
          *,
          contacts(name, document_number),
          invoices(invoice_number),
          users!delivery_notes_user_id_fkey(id, full_name)
        `)
        .eq('company_id', req.user.company_id)
        .order('created_at', { ascending: false });

      if (req.user.branch_id) {
        query = query.eq('branch_id', req.user.branch_id);
      }

      const { data, error } = await query;

      if (error) throw error;

      return res.json({ delivery_notes: data || [] });
    } catch (err) {
      return respondError(res, err, 'Error al listar notas de entrega');
    }
  }
);

router.post(
  '/delivery-notes',
  authenticate,
  checkPermission('ventas', 'create'),
  async (req, res) => {
    try {
      const {
        invoice_id,
        contact_id,
        delivery_date,
        delivery_address,
        warehouse_id,
        notes,
      } = req.body;

      if (invoice_id) {
        const { data: invoice, error: invoiceError } = await supabase
          .from('invoices')
          .select('id, contact_id')
          .eq('id', invoice_id)
          .eq('company_id', req.user.company_id)
          .eq('branch_id', req.user.branch_id)
          .single();

        if (invoiceError || !invoice) {
          return res.status(400).json({
            error: 'La factura indicada no existe en esta sucursal.',
          });
        }
      }

      const deliveryNumber = await getNextNumber(
        'delivery_notes',
        'delivery_number',
        'GR',
        req.user.branch_id,
        req.user.company_id
      );

      const { data, error } = await supabase
        .from('delivery_notes')
        .insert({
          id: uuidv4(),
          company_id: req.user.company_id,
          branch_id: req.user.branch_id,
          user_id: req.user.id,
          delivery_number: deliveryNumber,
          invoice_id: invoice_id || null,
          contact_id: contact_id || null,
          warehouse_id: warehouse_id || null,
          delivery_date: delivery_date || today(),
          delivery_address: delivery_address || null,
          notes: notes || null,
          status: 'pendiente',
        })
        .select()
        .single();

      if (error) throw error;

      return res.status(201).json({
        message: 'Nota de entrega creada.',
        delivery_note: data,
      });
    } catch (err) {
      return respondError(res, err, 'Error al crear nota de entrega');
    }
  }
);

// ============================================
// FACTURAS RECURRENTES
// ============================================

router.get(
  '/recurring',
  authenticate,
  checkPermission('facturas', 'read'),
  async (req, res) => {
    try {
      let query = supabase
        .from('recurring_invoices')
        .select(`
          *,
          contacts(name, document_number),
          users!recurring_invoices_user_id_fkey(id, full_name),
          recurring_invoice_items(*)
        `)
        .eq('company_id', req.user.company_id)
        .order('next_issue_date', { ascending: true });

      if (req.user.branch_id) {
        query = query.eq('branch_id', req.user.branch_id);
      }

      const { data, error } = await query;
     

      if (error) throw error;

      return res.json({ recurring: data || [] });
    } catch (err) {
      return respondError(res, err, 'Error al listar facturas recurrentes');
    }
  }
);

router.post(
  '/recurring',
  authenticate,
  checkPermission('facturas', 'create'),
  async (req, res) => {
    try {
      const {
        contact_id,
        frequency = 'mensual',
        start_date,
        end_date,
        next_issue_date,
        items,
        notes,
      } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          error: 'La factura recurrente debe tener al menos un artículo.',
        });
      }

      const validFrequencies = [
        'semanal',
        'mensual',
        'trimestral',
        'anual',
      ];

      if (!validFrequencies.includes(frequency)) {
        return res.status(400).json({
          error:
            'La frecuencia debe ser semanal, mensual, trimestral o anual.',
        });
      }

      const normalizedItems = items.map((item) => calculateItem(item));

      const products = await getActiveProducts(
        normalizedItems.map((item) => item.product_id),
        req.user.company_id,
        req.user.branch_id
      );

      normalizedItems.forEach((item, index) => {
        const product = item.product_id
          ? products.get(item.product_id)
          : null;

        if (product) {
          if (!item.unit) item.unit = product.unit || null;
          if (!item.description) item.description = product.name;

          const originalTax = items[index].tax_rate;

          if (
            originalTax === undefined ||
            originalTax === null ||
            originalTax === ''
          ) {
            Object.assign(
              item,
              calculateItem({
                ...items[index],
                ...item,
                tax_rate: number(product.tax_rate, DEFAULT_TAX_RATE),
              })
            );
          }
        }
      });

      const recurringNumber = await getNextNumber(
        'recurring_invoices',
        'recurring_number',
        'REC',
        req.user.branch_id,
        req.user.company_id
      );

      const { data: recurring, error } = await supabase
        .from('recurring_invoices')
        .insert({
          id: uuidv4(),
          company_id: req.user.company_id,
          branch_id: req.user.branch_id,
          contact_id: contact_id || null,
          user_id: req.user.id,
          recurring_number: recurringNumber,
          frequency,
          start_date: start_date || next_issue_date || today(),
          end_date: end_date || null,
          next_issue_date: next_issue_date || start_date || today(),
          status: 'activa',
          currency: 'NIO',
          notes: notes || null,
        })
        .select()
        .single();

      if (error) throw error;

      const rows = normalizedItems.map((item) => ({
        id: uuidv4(),
        recurring_invoice_id: recurring.id,
        product_id: item.product_id,
        description:
          item.description ||
          (item.product_id ? products.get(item.product_id)?.name : null) ||
          'Artículo',
        quantity: item.quantity,
        unit: item.unit || null,
        unit_price: item.unit_price,
        tax_rate: item.tax_rate,
      }));

      const { error: itemsError } = await supabase
        .from('recurring_invoice_items')
        .insert(rows);

      if (itemsError) throw itemsError;

      return res.status(201).json({
        message: 'Factura recurrente creada.',
        recurring,
      });
    } catch (err) {
      return respondError(res, err, 'Error al crear factura recurrente');
    }
  }
);

export default router;