-- Prepared source snapshots are append-only, including writes outside the ORM.
CREATE TRIGGER immutable_production_output_document BEFORE UPDATE OR DELETE OR TRUNCATE
ON production.output_document FOR EACH STATEMENT
EXECUTE FUNCTION production.reject_order_ownership_mutation();

CREATE OR REPLACE FUNCTION production.guard_output_document_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE o record;
DECLARE s record;
DECLARE p record;
DECLARE c jsonb := NEW.command::jsonb;
DECLARE snap jsonb := NEW.snapshot::jsonb;
BEGIN
  PERFORM 1 FROM accounting.organization WHERE id=NEW.organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Output organization is missing'; END IF;
  SELECT * INTO o FROM production.production_order WHERE id=NEW.order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Output order is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM production.order_ownership
      WHERE order_id=NEW.order_id AND organization_id=NEW.organization_id)
    OR o.completed_at IS NOT NULL OR o.stage='done' THEN
    RAISE EXCEPTION 'Output order is not available in this organization';
  END IF;
  SELECT * INTO s FROM public.sku WHERE code=c->>'sku_code' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Output SKU is missing'; END IF;
  SELECT * INTO p FROM wms.location WHERE id=(c->>'location_id')::integer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Output receiving place is missing'; END IF;
  IF NOT s.is_active OR NULLIF(btrim(s.unit),'') IS NULL OR NOT p.is_active
    OR p.warehouse IS DISTINCT FROM c->>'warehouse'
    OR c->'order_id' IS DISTINCT FROM to_jsonb(NEW.order_id)
    OR c->>'request_id' IS DISTINCT FROM NEW.request_id
    OR jsonb_typeof(c) IS DISTINCT FROM 'object'
    OR jsonb_typeof(c->'quantity') IS DISTINCT FROM 'string'
    OR coalesce(c->>'quantity','') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
    OR (c->>'quantity')::numeric<=0
    OR NULLIF(btrim(NEW.actor),'') IS NULL
    OR NEW.digest !~ '^[a-f0-9]{64}$'
    OR snap IS DISTINCT FROM jsonb_build_object(
      'organization_id', NEW.organization_id, 'principal', NEW.actor,
      'command', c, 'posted', false, 'confirmation_available', false,
      'order_snapshot', jsonb_build_object('order_id', o.id, 'number', o.number,
        'product', o.product, 'quantity', o.qty, 'stage', o.stage,
        'created_at', snap->'order_snapshot'->'created_at'),
      'sku_snapshot', jsonb_build_object('id',s.id,'code',s.code,'title',s.title,'unit',s.unit),
      'receiving_place', jsonb_build_object('location_id',p.id,'warehouse',p.warehouse,
        'code',p.code,'zone',p.zone,'title',p.title))
    OR (snap->'order_snapshot'->>'created_at')::timestamptz IS DISTINCT FROM o.created_at THEN
    RAISE EXCEPTION 'Output document does not match its source';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_production_output_document BEFORE INSERT ON production.output_document
FOR EACH ROW EXECUTE FUNCTION production.guard_output_document_insert();

CREATE TRIGGER immutable_production_output_confirmation BEFORE UPDATE OR DELETE OR TRUNCATE
ON production.output_confirmation FOR EACH STATEMENT
EXECUTE FUNCTION production.reject_order_ownership_mutation();

CREATE OR REPLACE FUNCTION production.guard_output_confirmation_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE d production.output_document%ROWTYPE;
DECLARE o production.production_order%ROWTYPE;
DECLARE total numeric;
DECLARE e record;
BEGIN
  PERFORM 1 FROM accounting.organization WHERE id=NEW.organization_id FOR UPDATE;
  SELECT * INTO o FROM production.production_order WHERE id=NEW.order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Output order is missing'; END IF;
  SELECT * INTO d FROM production.output_document WHERE id=NEW.document_id;
  IF NOT FOUND OR d.organization_id IS DISTINCT FROM NEW.organization_id
    OR d.order_id IS DISTINCT FROM NEW.order_id OR d.digest IS DISTINCT FROM NEW.digest
    OR NEW.quantity IS DISTINCT FROM (d.command->>'quantity')::numeric
    OR NEW.quantity<=0 OR NEW.quantity::text IN ('NaN','Infinity','-Infinity')
    OR NULLIF(btrim(NEW.actor),'') IS NULL OR o.completed_at IS NOT NULL OR o.stage='done' THEN
    RAISE EXCEPTION 'Output confirmation does not match its document';
  END IF;
  SELECT coalesce(sum(quantity),0) INTO total FROM production.output_confirmation WHERE order_id=NEW.order_id;
  IF total+NEW.quantity>o.qty THEN RAISE EXCEPTION 'Confirmed output exceeds order quantity'; END IF;
  IF NOT EXISTS (SELECT 1 FROM accounting.source_control s
      WHERE s.organization_id=NEW.organization_id AND s.source='production:output:'||d.id
        AND s.version=1 AND s.month=substring(d.command->>'operation_date',1,7) AND s.entry_id IS NULL) THEN
    RAISE EXCEPTION 'Output confirmation requires its pending accounting source';
  END IF;
  SELECT * INTO e FROM public.outbox_event WHERE id=NEW.event_id;
  IF NOT FOUND OR e.event_type IS DISTINCT FROM 'production.output.confirmed' OR e.version<>1
    OR e.payload::jsonb IS DISTINCT FROM jsonb_build_object(
      'output_document_id',d.id,'output_digest',d.digest,'organization_id',d.organization_id,
      'sku_code',d.command->>'sku_code','qty',d.command->>'quantity','warehouse',d.command->>'warehouse',
      'location_id',d.command::jsonb->'location_id','lot',d.command->>'lot',
      'operation_date',d.command->>'operation_date','entity_ref','production_output:'||d.id) THEN
    RAISE EXCEPTION 'Output confirmation event differs from its document';
  END IF;
  IF EXISTS (SELECT 1 FROM production.output_confirmation c
    JOIN production.output_document previous ON previous.id=c.document_id
    WHERE c.order_id=NEW.order_id AND
      (previous.snapshot::jsonb->'sku_snapshot'->'code' IS DISTINCT FROM d.snapshot::jsonb->'sku_snapshot'->'code'
       OR previous.snapshot::jsonb->'sku_snapshot'->'unit' IS DISTINCT FROM d.snapshot::jsonb->'sku_snapshot'->'unit')) THEN
    RAISE EXCEPTION 'Partial output SKU or unit differs';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_production_output_confirmation BEFORE INSERT ON production.output_confirmation
FOR EACH ROW EXECUTE FUNCTION production.guard_output_confirmation_insert();

-- A confirmed physical source cannot be moved out of its accounting period.
CREATE OR REPLACE FUNCTION production.guard_output_source_control() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source LIKE 'production:output:%' AND NOT EXISTS (
    SELECT 1 FROM production.output_document d
    WHERE NEW.source='production:output:'||d.id AND NEW.organization_id=d.organization_id
      AND NEW.version=1 AND NEW.month=substring(d.command->>'operation_date',1,7)) THEN
    RAISE EXCEPTION 'Production output accounting source differs from its document';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER valid_production_output_source BEFORE INSERT OR UPDATE ON accounting.source_control
FOR EACH ROW EXECUTE FUNCTION production.guard_output_source_control();

CREATE OR REPLACE FUNCTION production.guard_output_source_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM production.output_confirmation) THEN
    RAISE EXCEPTION 'Confirmed production output accounting sources cannot be truncated';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER preserve_production_output_sources BEFORE TRUNCATE ON accounting.source_control
FOR EACH STATEMENT EXECUTE FUNCTION production.guard_output_source_truncate();
