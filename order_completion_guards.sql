CREATE TRIGGER immutable_order_completion BEFORE UPDATE OR DELETE OR TRUNCATE ON production.order_completion
FOR EACH STATEMENT EXECUTE FUNCTION production.reject_order_ownership_mutation();

CREATE FUNCTION production.check_order_completion_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o production.production_order%ROWTYPE; total numeric; accepted numeric; rejected numeric; missing integer; earliest date;
DECLARE documents jsonb; unit_name text; unit_count integer; sku_code text; lot_value text; lot_count integer; expected jsonb;
BEGIN
  PERFORM 1 FROM accounting.organization WHERE id=NEW.organization_id FOR UPDATE;
  SELECT * INTO o FROM production.production_order WHERE id=NEW.order_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM production.order_ownership WHERE order_id=o.id AND organization_id=NEW.organization_id)
    OR o.completed_at IS NOT NULL OR o.stage='done' OR o.qty<=0 OR NULLIF(btrim(NEW.actor),'') IS NULL THEN
    RAISE EXCEPTION 'Order completion source is unavailable';
  END IF;
  SELECT sum(c.quantity),sum(a.accepted_quantity),sum(a.rejected_quantity),
    count(*) FILTER (WHERE a.receipt_id IS NULL OR r.status IS DISTINCT FROM 'accepted'),max((d.command->>'operation_date')::date)
    INTO total,accepted,rejected,missing,earliest FROM production.output_confirmation c
    JOIN production.output_document d ON d.id=c.document_id
    LEFT JOIN wms.production_arrival a ON a.event_id=c.event_id
    LEFT JOIN wms.receipt r ON r.id=a.receipt_id WHERE c.order_id=o.id;
  IF total IS DISTINCT FROM o.qty::numeric OR accepted IS DISTINCT FROM o.qty::numeric
    OR rejected IS DISTINCT FROM 0::numeric OR missing<>0
    OR (NEW.command->>'operation_date')::date<earliest
    OR coalesce(NEW.command->>'expected_digest','') !~ '^[a-f0-9]{64}$'
    OR length(btrim(coalesce(NEW.command->>'evidence','')))<10
    OR NEW.snapshot::jsonb->'order'->'order_id' IS DISTINCT FROM to_jsonb(o.id)
    OR NEW.snapshot::jsonb->'order'->'quantity' IS DISTINCT FROM to_jsonb(o.qty) THEN
    RAISE EXCEPTION 'Order completion requires fully accepted output';
  END IF;
  IF jsonb_typeof(NEW.command::jsonb) IS DISTINCT FROM 'object'
    OR NEW.command::jsonb IS DISTINCT FROM jsonb_build_object('expected_digest',NEW.command->>'expected_digest',
      'operation_date',NEW.command->>'operation_date','evidence',NEW.command->>'evidence')
    OR coalesce(NEW.command->>'operation_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR length(NEW.command->>'evidence')>1000 THEN
    RAISE EXCEPTION 'Order completion command is incomplete';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('document_id',d.id,'request_id',d.request_id,
      'sku_code',d.snapshot->'sku_snapshot'->>'code','lot',d.command->>'lot',
      'operation_date',d.command->>'operation_date','quantity',to_char(c.quantity,'FM9999999999990.00'),
      'state',r.status,'receipt_id',r.id,
      'accepted_quantity',to_char(a.accepted_quantity,'FM9999999999990.00'),
      'rejected_quantity',to_char(a.rejected_quantity,'FM9999999999990.00'),
      'movement_ids',CASE WHEN a.movement_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(a.movement_id) END) ORDER BY d.id),
    min(d.snapshot->'sku_snapshot'->>'unit'),
    count(DISTINCT (d.snapshot->'sku_snapshot'->>'code',d.snapshot->'sku_snapshot'->>'unit')),
    min(d.snapshot->'sku_snapshot'->>'code'), min(NULLIF(d.command->>'lot','')),
    count(DISTINCT NULLIF(d.command->>'lot',''))
    INTO documents,unit_name,unit_count,sku_code,lot_value,lot_count FROM production.output_confirmation c
    JOIN production.output_document d ON d.id=c.document_id
    JOIN wms.production_arrival a ON a.event_id=c.event_id
    JOIN wms.receipt r ON r.id=a.receipt_id WHERE c.order_id=o.id;
  expected := jsonb_build_object('order',jsonb_build_object('order_id',o.id,'number',o.number,
      'product',o.product,'quantity',o.qty,'stage',o.stage,'created_at',NEW.snapshot::jsonb->'order'->'created_at'),
    'minimum_date',to_char(earliest,'YYYY-MM-DD'),
    'reconciliation',jsonb_build_object('organization_id',NEW.organization_id,'order_id',o.id,'planned_quantity',o.qty::text,
      'confirmed_quantity',to_char(total,'FM9999999999990.00'),'accepted_quantity',to_char(accepted,'FM9999999999990.00'),
      'rejected_quantity','0.00','pending_quantity','0.00','documents',documents,
      'sku_code',CASE WHEN unit_count=1 THEN sku_code ELSE NULL END,
      'lot',CASE WHEN lot_count=1 THEN lot_value ELSE NULL END,'unit',unit_name,
      'scope','confirmed_output_documents','accounting_final',false));
  IF unit_count<>1 OR unit_name IS NULL OR NEW.snapshot::jsonb IS DISTINCT FROM expected
    OR (NEW.snapshot->'order'->>'created_at')::timestamp IS DISTINCT FROM o.created_at THEN
    RAISE EXCEPTION 'Order completion snapshot differs from its sources';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER check_order_completion_insert BEFORE INSERT ON production.order_completion
FOR EACH ROW EXECUTE FUNCTION production.check_order_completion_insert();

CREATE FUNCTION production.check_completed_order_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target integer; o production.production_order%ROWTYPE; c production.order_completion%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='order_completion' THEN target:=NEW.order_id; ELSE target:=NEW.id; END IF;
  SELECT * INTO c FROM production.order_completion WHERE order_id=target;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO o FROM production.production_order WHERE id=target;
  IF o.stage IS DISTINCT FROM 'done' OR o.progress IS DISTINCT FROM 100 OR o.made_qty IS DISTINCT FROM o.qty
    OR o.qty IS DISTINCT FROM (c.snapshot->'order'->>'quantity')::integer
    OR o.completed_at IS DISTINCT FROM (c.command->>'operation_date')::timestamp THEN
    RAISE EXCEPTION 'Completed order state differs from completion receipt';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER check_order_completion_state AFTER INSERT ON production.order_completion
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION production.check_completed_order_state();
CREATE CONSTRAINT TRIGGER check_completed_order_state AFTER UPDATE ON production.production_order
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION production.check_completed_order_state();
