CREATE SEQUENCE IF NOT EXISTS public.purchase_number_seq;

CREATE TABLE IF NOT EXISTS public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_number text NOT NULL UNIQUE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  supplier_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id),
  supplier_invoice_number text,
  purchase_date date NOT NULL DEFAULT CURRENT_DATE,
  subtotal numeric(14, 2) NOT NULL DEFAULT 0,
  tax_amount numeric(14, 2) NOT NULL DEFAULT 0,
  total numeric(14, 2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchases_supplier_id_fkey
    FOREIGN KEY (supplier_id) REFERENCES public.contacts(id),
  CONSTRAINT purchases_warehouse_id_fkey
    FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id)
);

CREATE TABLE IF NOT EXISTS public.purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  description text NOT NULL,
  quantity numeric(14, 3) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14, 4) NOT NULL CHECK (unit_cost >= 0),
  tax_rate numeric(5, 2) NOT NULL DEFAULT 15 CHECK (tax_rate BETWEEN 0 AND 100),
  tax_amount numeric(14, 2) NOT NULL DEFAULT 0,
  line_total numeric(14, 2) NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS purchases_supplier_invoice_unique
  ON public.purchases(company_id, supplier_id, supplier_invoice_number)
  WHERE supplier_invoice_number IS NOT NULL;

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.purchases, public.purchase_items TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.purchase_number_seq TO service_role;

CREATE OR REPLACE FUNCTION public.register_purchase(
  p_company_id uuid,
  p_branch_id uuid,
  p_supplier_id uuid,
  p_warehouse_id uuid,
  p_user_id uuid,
  p_supplier_invoice_number text,
  p_purchase_date date,
  p_notes text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_purchase_id uuid := gen_random_uuid();
  v_purchase_number text;
  v_item jsonb;
  v_product public.products%ROWTYPE;
  v_stock public.stock%ROWTYPE;
  v_quantity numeric(14, 3);
  v_unit_cost numeric(14, 4);
  v_tax_rate numeric(5, 2);
  v_subtotal numeric(14, 2) := 0;
  v_tax_amount numeric(14, 2) := 0;
  v_line_tax numeric(14, 2);
  v_line_total numeric(14, 2);
  v_total numeric(14, 2) := 0;
BEGIN
  IF p_items IS NULL THEN
    RAISE EXCEPTION 'La compra debe incluir al menos un producto.';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'La lista de productos de la compra no es válida.';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La compra debe incluir al menos un producto.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM contacts
    WHERE id = p_supplier_id
      AND company_id = p_company_id
      AND type = 'proveedor'
  ) THEN
    RAISE EXCEPTION 'El proveedor no existe o no pertenece a esta empresa.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM warehouses w
    JOIN branches b ON b.id = w.branch_id
    WHERE w.id = p_warehouse_id
      AND w.branch_id = p_branch_id
      AND b.company_id = p_company_id
      AND COALESCE(w.is_active, true)
  ) THEN
    RAISE EXCEPTION 'La bodega no está activa o no pertenece a esta sucursal.';
  END IF;

  v_purchase_number := 'COMP-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' ||
    lpad(nextval('public.purchase_number_seq')::text, 6, '0');

  INSERT INTO purchases (
    id, purchase_number, company_id, branch_id, supplier_id,
    warehouse_id, user_id, supplier_invoice_number, purchase_date, notes
  ) VALUES (
    v_purchase_id, v_purchase_number, p_company_id, p_branch_id, p_supplier_id,
    p_warehouse_id, p_user_id, NULLIF(btrim(p_supplier_invoice_number), ''),
    COALESCE(p_purchase_date, CURRENT_DATE), NULLIF(btrim(p_notes), '')
  );

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_cost := (v_item->>'unit_cost')::numeric;
    v_tax_rate := COALESCE((v_item->>'tax_rate')::numeric, 15);

    IF v_quantity <= 0 OR v_unit_cost < 0 OR v_tax_rate < 0 OR v_tax_rate > 100 THEN
      RAISE EXCEPTION 'Cantidad, costo o impuesto inválido.';
    END IF;

    SELECT * INTO v_product
    FROM products
    WHERE id = (v_item->>'product_id')::uuid
      AND company_id = p_company_id
      AND branch_id = p_branch_id
      AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Uno de los productos no existe, está inactivo o no pertenece a esta sucursal.';
    END IF;

    v_line_tax := round(v_quantity * v_unit_cost * v_tax_rate / 100, 2);
    v_line_total := round(v_quantity * v_unit_cost + v_line_tax, 2);
    v_subtotal := v_subtotal + round(v_quantity * v_unit_cost, 2);
    v_tax_amount := v_tax_amount + v_line_tax;
    v_total := v_total + v_line_total;

    INSERT INTO purchase_items (
      purchase_id, product_id, description, quantity, unit_cost,
      tax_rate, tax_amount, line_total
    ) VALUES (
      v_purchase_id, v_product.id, v_product.name, v_quantity, v_unit_cost,
      v_tax_rate, v_line_tax, v_line_total
    );

    PERFORM pg_advisory_xact_lock(hashtext(v_product.id::text || ':' || p_warehouse_id::text));

    SELECT * INTO v_stock
    FROM stock
    WHERE product_id = v_product.id
      AND warehouse_id = p_warehouse_id
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      UPDATE stock
      SET quantity = COALESCE(v_stock.quantity, 0) + v_quantity,
          updated_at = now()
      WHERE id = v_stock.id;
    ELSE
      INSERT INTO stock (id, product_id, warehouse_id, quantity, reserved)
      VALUES (gen_random_uuid(), v_product.id, p_warehouse_id, v_quantity, 0);
    END IF;

    INSERT INTO inventory_movements (
      id, company_id, branch_id, product_id, warehouse_id,
      movement_type, quantity, unit_cost, reference_type, reference_id,
      notes, user_id
    ) VALUES (
      gen_random_uuid(), p_company_id, p_branch_id, v_product.id, p_warehouse_id,
      'entrada', v_quantity, v_unit_cost, 'compra', v_purchase_id,
      'Compra ' || v_purchase_number, p_user_id
    );
  END LOOP;

  UPDATE purchases
  SET subtotal = v_subtotal, tax_amount = v_tax_amount, total = v_total
  WHERE id = v_purchase_id;

  RETURN jsonb_build_object(
    'id', v_purchase_id,
    'purchase_number', v_purchase_number,
    'supplier_invoice_number', NULLIF(btrim(p_supplier_invoice_number), ''),
    'subtotal', v_subtotal,
    'tax_amount', v_tax_amount,
    'total', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_purchase(
  uuid, uuid, uuid, uuid, uuid, text, date, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_purchase(
  uuid, uuid, uuid, uuid, uuid, text, date, text, jsonb
) TO service_role;

NOTIFY pgrst, 'reload schema';
