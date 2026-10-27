
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { authenticate, checkPermission } from '../middleware/auth.js';

const router = Router();

// CU-13: Listar pagos
router.get(
  '/',
  authenticate,
  checkPermission('pagos', 'read'),
  async (req, res) => {
    try {
      const { contact_id, invoice_id, from_date, to_date, status } =
        req.query;

      let query = supabase
        .from('payments')
        .select(`
          *,
          contacts(id, name, document_number),
          invoices(id, invoice_number, total, amount_paid, balance_due, status, payment_status),
          users!payments_created_by_fkey(id, full_name)
        `)
        .eq('company_id', req.user.company_id)
        .order('created_at', { ascending: false });

      // Cada usuario queda limitado a su sucursal.
      if (req.user.branch_id) {
        query = query.eq('branch_id', req.user.branch_id);
      }

      if (contact_id) query = query.eq('contact_id', contact_id);
      if (invoice_id) query = query.eq('invoice_id', invoice_id);
      if (from_date) query = query.gte('payment_date', from_date);
      if (to_date) query = query.lte('payment_date', to_date);

      if (status && ['activo', 'anulado'].includes(status)) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) throw error;

      return res.json({ payments: data || [] });
    } catch (err) {
      console.error('Error listando pagos:', err.message);

      return res.status(500).json({
        error: 'Error al listar los pagos.'
      });
    }
  }
);

// CU-13: Registrar un pago asociado obligatoriamente a una factura
router.post(
  '/',
  authenticate,
  checkPermission('pagos', 'create'),
  async (req, res) => {
    try {
      const {
        invoice_id,
        amount,
        payment_method = 'efectivo',
        payment_date,
        reference,
        notes
      } = req.body;

      if (!invoice_id) {
        return res.status(400).json({
          error: 'Debes seleccionar una factura.'
        });
      }

      const parsedAmount = Number(amount);

      if (
        amount === undefined ||
        amount === null ||
        amount === '' ||
        !Number.isFinite(parsedAmount) ||
        parsedAmount <= 0
      ) {
        return res.status(400).json({
          error: 'El monto debe ser un número mayor que cero.'
        });
      }

      if (
        typeof payment_method !== 'string' ||
        !payment_method.trim()
      ) {
        return res.status(400).json({
          error: 'Debes seleccionar un método de pago válido.'
        });
      }

      const date = payment_date || new Date().toISOString().slice(0, 10);

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          error: 'La fecha del pago debe tener el formato YYYY-MM-DD.'
        });
      }

      if (!req.user.branch_id) {
        return res.status(403).json({
          error: 'El usuario no tiene una sucursal asignada.'
        });
      }

      // La función SQL valida la factura, bloquea su fila,
      // registra el pago y actualiza los saldos en una transacción.
      const { data, error } = await supabase.rpc(
        'register_invoice_payment',
        {
          p_company_id: req.user.company_id,
          p_branch_id: req.user.branch_id,
          p_user_id: req.user.id,
          p_invoice_id: invoice_id,
          p_amount: parsedAmount,
          p_payment_method: payment_method.trim(),
          p_payment_date: date,
          p_reference: reference?.trim() || null,
          p_notes: notes?.trim() || null
        }
      );

      if (error) {
        console.error('Error registrando pago:', error.message);

        const message = error.message || '';

        if (
          message.includes('Factura no encontrada') ||
          message.includes('facturas emitidas') ||
          message.includes('saldo pendiente') ||
          message.includes('supera el saldo')
        ) {
          return res.status(400).json({ error: message });
        }

        return res.status(500).json({
          error: 'No se pudo registrar el pago.'
        });
      }

      return res.status(201).json({
        message: 'Pago registrado correctamente.',
        ...data
      });
    } catch (err) {
      console.error('Error registrando pago:', err.message);

      return res.status(500).json({
        error: 'Error interno al registrar el pago.'
      });
    }
  }
);

// CU-13: Anular un pago conservando su historial
router.post(
  '/:id/cancel',
  authenticate,
  checkPermission('pagos', 'delete'),
  async (req, res) => {
    try {
      if (!req.user.branch_id) {
        return res.status(403).json({
          error: 'El usuario no tiene una sucursal asignada.'
        });
      }

      const { data, error } = await supabase.rpc(
        'cancel_invoice_payment',
        {
          p_payment_id: req.params.id,
          p_company_id: req.user.company_id,
          p_branch_id: req.user.branch_id
        }
      );

      if (error) {
        console.error('Error anulando pago:', error.message);

        const message = error.message || '';

        if (
          message.includes('Pago no encontrado') ||
          message.includes('ya fue anulado') ||
          message.includes('factura asociada')
        ) {
          return res.status(400).json({ error: message });
        }

        return res.status(500).json({
          error: 'No se pudo anular el pago.'
        });
      }

      return res.json(data);
    } catch (err) {
      console.error('Error anulando pago:', err.message);

      return res.status(500).json({
        error: 'Error interno al anular el pago.'
      });
    }
  }
);

export default router;
