CREATE TRIGGER immutable_production_order_creation BEFORE UPDATE OR DELETE OR TRUNCATE
ON production.order_creation_receipt FOR EACH STATEMENT
EXECUTE FUNCTION production.reject_order_ownership_mutation();

CREATE OR REPLACE FUNCTION production.guard_order_creation_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE o production.production_order%ROWTYPE;
DECLARE own production.order_ownership%ROWTYPE;
BEGIN
  PERFORM 1 FROM accounting.organization WHERE id=NEW.organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production creation organization is missing'; END IF;
  SELECT * INTO o FROM production.production_order WHERE id=NEW.order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production creation order is missing'; END IF;
  SELECT * INTO own FROM production.order_ownership WHERE order_id=NEW.order_id;
  IF NOT FOUND OR own.organization_id IS DISTINCT FROM NEW.organization_id
    OR own.actor IS DISTINCT FROM NEW.actor
    OR jsonb_typeof(NEW.command::jsonb) IS DISTINCT FROM 'object'
    OR NEW.command::jsonb IS DISTINCT FROM jsonb_build_object(
      'request_id', NEW.request_id, 'product', o.product, 'quantity', o.qty, 'evidence', own.evidence)
    OR NEW.result::jsonb IS DISTINCT FROM (to_jsonb(o) - ARRAY['created_at','completed_at'])
    OR o.stage IS DISTINCT FROM 'queue' OR o.made_qty<>0 OR o.qty<=0
    OR o.completed_at IS NOT NULL OR o.progress<>0
    OR NEW.request_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR NEW.digest !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Production creation receipt does not match its source';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_production_order_creation BEFORE INSERT ON production.order_creation_receipt
FOR EACH ROW EXECUTE FUNCTION production.guard_order_creation_insert();
