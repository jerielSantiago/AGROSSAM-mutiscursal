BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS branch_id uuid;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS branch_id uuid;

CREATE TEMP TABLE product_branch_targets (
  product_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  PRIMARY KEY (product_id, branch_id)
) ON COMMIT DROP;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.stock s
    LEFT JOIN public.warehouses w ON w.id = s.warehouse_id
    WHERE s.product_id IS NOT NULL
      AND w.branch_id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.batches b
    LEFT JOIN public.warehouses w ON w.id = b.warehouse_id
    WHERE b.product_id IS NOT NULL
      AND w.branch_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Hay existencias o lotes sin una bodega asignada a sucursal. Corrige esos registros antes de separar los catálogos.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_movements im
    LEFT JOIN public.warehouses w ON w.id = im.warehouse_id
    WHERE im.product_id IS NOT NULL
      AND COALESCE(im.branch_id, w.branch_id) IS NULL
  ) THEN
    RAISE EXCEPTION 'Hay movimientos de inventario sin sucursal ni bodega con sucursal. Corrige esos registros antes de separar los catálogos.';
  END IF;
END;
$$;

CREATE TEMP TABLE category_branch_targets (
  category_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  PRIMARY KEY (category_id, branch_id)
) ON COMMIT DROP;

CREATE TEMP TABLE category_branch_map (
  source_category_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  branch_category_id uuid NOT NULL,
  PRIMARY KEY (source_category_id, branch_id)
) ON COMMIT DROP;

CREATE TEMP TABLE category_parent_map (
  category_id uuid PRIMARY KEY,
  parent_id uuid
) ON COMMIT DROP;

INSERT INTO product_branch_targets (product_id, branch_id)
SELECT id, branch_id
FROM public.products
WHERE branch_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO product_branch_targets (product_id, branch_id)
SELECT s.product_id, w.branch_id
FROM public.stock s
JOIN public.warehouses w ON w.id = s.warehouse_id
ON CONFLICT DO NOTHING;

INSERT INTO product_branch_targets (product_id, branch_id)
SELECT ii.product_id, i.branch_id
FROM public.invoice_items ii
JOIN public.invoices i ON i.id = ii.invoice_id
WHERE ii.product_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO product_branch_targets (product_id, branch_id)
SELECT qi.product_id, q.branch_id
FROM public.quote_items qi
JOIN public.quotes q ON q.id = qi.quote_id
WHERE qi.product_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO product_branch_targets (product_id, branch_id)
SELECT rii.product_id, ri.branch_id
FROM public.recurring_invoice_items rii
JOIN public.recurring_invoices ri ON ri.id = rii.recurring_invoice_id
WHERE rii.product_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO product_branch_targets (product_id, branch_id)
SELECT pi.product_id, p.branch_id
FROM public.purchase_items pi
JOIN public.purchases p ON p.id = pi.purchase_id
ON CONFLICT DO NOTHING;

INSERT INTO product_branch_targets (product_id, branch_id)
SELECT b.product_id, w.branch_id
FROM public.batches b
JOIN public.warehouses w ON w.id = b.warehouse_id
ON CONFLICT DO NOTHING;

INSERT INTO product_branch_targets (product_id, branch_id)
SELECT im.product_id, COALESCE(im.branch_id, w.branch_id)
FROM public.inventory_movements im
LEFT JOIN public.warehouses w ON w.id = im.warehouse_id
WHERE COALESCE(im.branch_id, w.branch_id) IS NOT NULL
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM product_branch_targets t
    JOIN public.products p ON p.id = t.product_id
    JOIN public.branches b ON b.id = t.branch_id
    WHERE p.company_id IS DISTINCT FROM b.company_id
  ) THEN
    RAISE EXCEPTION 'Hay productos relacionados con sucursales de otra empresa; no se aplicó ningún cambio.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.products p
    WHERE NOT EXISTS (
      SELECT 1
      FROM product_branch_targets t
      WHERE t.product_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.branches b
      WHERE b.company_id = p.company_id
        AND lower(b.name) = lower('Sucursal Principal')
    )
  ) THEN
    RAISE EXCEPTION 'No se encontró "Sucursal Principal" para todos los productos sin historial. Revisa las sucursales antes de continuar.';
  END IF;

END;
$$;

INSERT INTO product_branch_targets (product_id, branch_id)
SELECT p.id, b.id
FROM public.products p
JOIN LATERAL (
  SELECT id
  FROM public.branches
  WHERE company_id = p.company_id
    AND lower(name) = lower('Sucursal Principal')
  ORDER BY id
  LIMIT 1
) b ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM product_branch_targets t
  WHERE t.product_id = p.id
)
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT p.company_id, t.branch_id, upper(p.sku)
    FROM product_branch_targets t
    JOIN public.products p ON p.id = t.product_id
    GROUP BY p.company_id, t.branch_id, upper(p.sku)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay productos con SKU duplicado dentro de una sucursal. Corrige los SKU antes de separar los catálogos.';
  END IF;

  IF EXISTS (
    SELECT p.company_id, t.branch_id, upper(p.barcode)
    FROM product_branch_targets t
    JOIN public.products p ON p.id = t.product_id
    WHERE p.barcode IS NOT NULL AND btrim(p.barcode) <> ''
    GROUP BY p.company_id, t.branch_id, upper(p.barcode)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay productos con código de barras duplicado dentro de una sucursal. Corrige esos códigos antes de separar los catálogos.';
  END IF;
END;
$$;

DO $$
DECLARE
  v_index record;
BEGIN
  FOR v_index IN
    SELECT
      idx.relname AS index_name,
      con.conname AS constraint_name
    FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid
    WHERE i.indrelid = 'public.products'::regclass
      AND i.indisunique
      AND pg_get_indexdef(i.indexrelid) ~* '(sku|barcode)'
  LOOP
    IF v_index.constraint_name IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE public.products DROP CONSTRAINT %I',
        v_index.constraint_name
      );
    ELSE
      EXECUTE format(
        'DROP INDEX public.%I',
        v_index.index_name
      );
    END IF;
  END LOOP;
END;
$$;

CREATE TEMP TABLE product_branch_map (
  source_product_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  branch_product_id uuid NOT NULL,
  PRIMARY KEY (source_product_id, branch_id)
) ON COMMIT DROP;

DO $$
DECLARE
  v_product public.products%ROWTYPE;
  v_branch_ids uuid[];
  v_branch_id uuid;
  v_new_product_id uuid;
  v_index integer;
BEGIN
  FOR v_product IN
    SELECT *
    FROM public.products
    ORDER BY id
  LOOP
    SELECT array_agg(branch_id ORDER BY branch_id)
    INTO v_branch_ids
    FROM product_branch_targets
    WHERE product_id = v_product.id;

    IF v_branch_ids IS NULL OR cardinality(v_branch_ids) = 0 THEN
      RAISE EXCEPTION 'No se pudo determinar una sucursal para el producto %.', v_product.id;
    END IF;

    UPDATE public.products
    SET branch_id = v_branch_ids[1]
    WHERE id = v_product.id;

    INSERT INTO product_branch_map (
      source_product_id, branch_id, branch_product_id
    ) VALUES (
      v_product.id, v_branch_ids[1], v_product.id
    );

    IF cardinality(v_branch_ids) > 1 THEN
      FOR v_index IN 2..cardinality(v_branch_ids)
      LOOP
        v_branch_id := v_branch_ids[v_index];
        v_new_product_id := gen_random_uuid();

        INSERT INTO public.products
        SELECT (
          jsonb_populate_record(
            NULL::public.products,
            to_jsonb(v_product) || jsonb_build_object(
              'id', v_new_product_id,
              'branch_id', v_branch_id
            )
          )
        ).*;

        INSERT INTO product_branch_map (
          source_product_id, branch_id, branch_product_id
        ) VALUES (
          v_product.id, v_branch_id, v_new_product_id
        );
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

INSERT INTO category_branch_targets (category_id, branch_id)
SELECT DISTINCT p.category_id, m.branch_id
FROM product_branch_map m
JOIN public.products p ON p.id = m.source_product_id
WHERE p.category_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO category_branch_targets (category_id, branch_id)
SELECT c.id, b.id
FROM public.categories c
JOIN public.branches b ON b.company_id = c.company_id
WHERE c.company_id IS NOT NULL
ON CONFLICT DO NOTHING;

WITH RECURSIVE parent_targets(category_id, branch_id) AS (
  SELECT c.parent_id, t.branch_id
  FROM category_branch_targets t
  JOIN public.categories c ON c.id = t.category_id
  WHERE c.parent_id IS NOT NULL
  UNION
  SELECT parent.parent_id, pt.branch_id
  FROM parent_targets pt
  JOIN public.categories parent ON parent.id = pt.category_id
  WHERE parent.parent_id IS NOT NULL
)
INSERT INTO category_branch_targets (category_id, branch_id)
SELECT category_id, branch_id
FROM parent_targets
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM category_branch_targets t
    JOIN public.categories c ON c.id = t.category_id
    JOIN public.branches b ON b.id = t.branch_id
    WHERE c.company_id IS NOT NULL
      AND c.company_id IS DISTINCT FROM b.company_id
  ) THEN
    RAISE EXCEPTION 'Hay categorías asociadas a sucursales de otra empresa. Corrige esas relaciones antes de continuar.';
  END IF;

  IF EXISTS (
    SELECT t.category_id
    FROM category_branch_targets t
    JOIN public.branches b ON b.id = t.branch_id
    GROUP BY t.category_id
    HAVING count(DISTINCT b.company_id) > 1
  ) THEN
    RAISE EXCEPTION 'Hay categorías vinculadas a productos de distintas empresas. Separa esas categorías antes de continuar.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.categories c
    WHERE NOT EXISTS (
      SELECT 1
      FROM category_branch_targets t
      WHERE t.category_id = c.id
    )
  ) THEN
    RAISE EXCEPTION 'Hay categorías sin empresa o sin sucursales asignables. Corrige esas categorías antes de continuar.';
  END IF;
END;
$$;

INSERT INTO category_parent_map (category_id, parent_id)
SELECT id, parent_id
FROM public.categories;

DO $$
DECLARE
  v_category public.categories%ROWTYPE;
  v_branch_ids uuid[];
  v_branch_id uuid;
  v_new_category_id uuid;
  v_index integer;
BEGIN
  FOR v_category IN
    SELECT c.*
    FROM public.categories c
    JOIN category_parent_map p ON p.category_id = c.id
    ORDER BY c.id
  LOOP
    SELECT array_agg(branch_id ORDER BY branch_id)
    INTO v_branch_ids
    FROM category_branch_targets
    WHERE category_id = v_category.id;

    IF v_branch_ids IS NULL OR cardinality(v_branch_ids) = 0 THEN
      RAISE EXCEPTION 'No se pudo determinar una sucursal para la categoría %.', v_category.id;
    END IF;

    UPDATE public.categories
    SET company_id = (
          SELECT company_id
          FROM public.branches
          WHERE id = v_branch_ids[1]
        ),
        branch_id = v_branch_ids[1],
        parent_id = NULL
    WHERE id = v_category.id;

    INSERT INTO category_branch_map (
      source_category_id, branch_id, branch_category_id
    ) VALUES (
      v_category.id, v_branch_ids[1], v_category.id
    );

    IF cardinality(v_branch_ids) > 1 THEN
      FOR v_index IN 2..cardinality(v_branch_ids)
      LOOP
        v_branch_id := v_branch_ids[v_index];
        v_new_category_id := gen_random_uuid();

        INSERT INTO public.categories
        SELECT (
          jsonb_populate_record(
            NULL::public.categories,
            to_jsonb(v_category) || jsonb_build_object(
              'id', v_new_category_id,
              'company_id', (
                SELECT company_id
                FROM public.branches
                WHERE id = v_branch_id
              ),
              'branch_id', v_branch_id,
              'parent_id', NULL
            )
          )
        ).*;

        INSERT INTO category_branch_map (
          source_category_id, branch_id, branch_category_id
        ) VALUES (
          v_category.id, v_branch_id, v_new_category_id
        );
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

UPDATE public.categories child
SET parent_id = parent_map.branch_category_id
FROM category_parent_map p,
     category_branch_map child_map,
     category_branch_map parent_map
WHERE child.id = child_map.branch_category_id
  AND p.category_id = child_map.source_category_id
  AND p.parent_id = parent_map.source_category_id
  AND child_map.branch_id = parent_map.branch_id;

UPDATE public.products p
SET category_id = cm.branch_category_id
FROM product_branch_map pm, category_branch_map cm
WHERE pm.branch_product_id = p.id
  AND cm.source_category_id = p.category_id
  AND cm.branch_id = pm.branch_id;

UPDATE public.stock s
SET product_id = m.branch_product_id
FROM public.warehouses w, product_branch_map m
WHERE w.id = s.warehouse_id
  AND m.source_product_id = s.product_id
  AND m.branch_id = w.branch_id;

UPDATE public.invoice_items ii
SET product_id = m.branch_product_id
FROM public.invoices i, product_branch_map m
WHERE i.id = ii.invoice_id
  AND m.source_product_id = ii.product_id
  AND m.branch_id = i.branch_id;

UPDATE public.quote_items qi
SET product_id = m.branch_product_id
FROM public.quotes q, product_branch_map m
WHERE q.id = qi.quote_id
  AND m.source_product_id = qi.product_id
  AND m.branch_id = q.branch_id;

UPDATE public.recurring_invoice_items rii
SET product_id = m.branch_product_id
FROM public.recurring_invoices ri, product_branch_map m
WHERE ri.id = rii.recurring_invoice_id
  AND m.source_product_id = rii.product_id
  AND m.branch_id = ri.branch_id;

UPDATE public.purchase_items pi
SET product_id = m.branch_product_id
FROM public.purchases p, product_branch_map m
WHERE p.id = pi.purchase_id
  AND m.source_product_id = pi.product_id
  AND m.branch_id = p.branch_id;

UPDATE public.batches b
SET product_id = m.branch_product_id
FROM public.warehouses w, product_branch_map m
WHERE w.id = b.warehouse_id
  AND m.source_product_id = b.product_id
  AND m.branch_id = w.branch_id;

UPDATE public.inventory_movements im
SET product_id = m.branch_product_id
FROM product_branch_map m
WHERE m.source_product_id = im.product_id
  AND m.branch_id = im.branch_id;

UPDATE public.inventory_movements im
SET product_id = m.branch_product_id
FROM public.warehouses w, product_branch_map m
WHERE im.branch_id IS NULL
  AND w.id = im.warehouse_id
  AND m.source_product_id = im.product_id
  AND m.branch_id = w.branch_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass
      AND conname = 'products_branch_id_fkey'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_branch_id_fkey
      FOREIGN KEY (branch_id) REFERENCES public.branches(id);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.categories'::regclass
      AND conname = 'categories_branch_id_fkey'
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_branch_id_fkey
      FOREIGN KEY (branch_id) REFERENCES public.branches(id);
  END IF;
END;
$$;

ALTER TABLE public.products
  ALTER COLUMN branch_id SET NOT NULL;

ALTER TABLE public.categories
  ALTER COLUMN branch_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS products_company_branch_sku_key
  ON public.products (company_id, branch_id, upper(sku));

CREATE UNIQUE INDEX IF NOT EXISTS products_company_branch_barcode_key
  ON public.products (company_id, branch_id, upper(barcode))
  WHERE barcode IS NOT NULL AND btrim(barcode) <> '';

CREATE INDEX IF NOT EXISTS categories_company_branch_active_idx
  ON public.categories (company_id, branch_id, is_active);

COMMIT;

NOTIFY pgrst, 'reload schema';
