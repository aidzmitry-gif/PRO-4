ALTER TABLE production.order_ownership ADD CONSTRAINT fk_production_owner_organization
FOREIGN KEY (organization_id) REFERENCES accounting.organization(id);

CREATE OR REPLACE FUNCTION production.reject_order_ownership_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Production order ownership is immutable';
END $$;
CREATE TRIGGER immutable_production_order_ownership BEFORE UPDATE OR DELETE OR TRUNCATE
ON production.order_ownership FOR EACH STATEMENT EXECUTE FUNCTION production.reject_order_ownership_mutation();

CREATE OR REPLACE FUNCTION production.guard_order_ownership_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE o production.production_order%ROWTYPE;
BEGIN
  PERFORM 1 FROM accounting.organization WHERE id=NEW.organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production ownership organization is missing'; END IF;
  SELECT * INTO o FROM production.production_order WHERE id=NEW.order_id FOR UPDATE;
  IF NOT FOUND OR jsonb_typeof(NEW.snapshot::jsonb) IS DISTINCT FROM 'object'
    OR (NEW.snapshot->>'order_id')::integer IS DISTINCT FROM o.id
    OR NEW.snapshot->>'number' IS DISTINCT FROM o.number
    OR NEW.snapshot->>'product' IS DISTINCT FROM o.product
    OR (NEW.snapshot->>'quantity')::integer IS DISTINCT FROM o.qty
    OR NEW.snapshot->>'stage' IS DISTINCT FROM o.stage
    OR (NEW.snapshot->>'created_at')::timestamp IS DISTINCT FROM o.created_at
    OR NEW.digest !~ '^[a-f0-9]{64}$'
    OR length(btrim(NEW.evidence))<10 OR length(btrim(NEW.actor))=0 THEN
    RAISE EXCEPTION 'Production ownership snapshot does not match the order';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_production_order_ownership BEFORE INSERT ON production.order_ownership
FOR EACH ROW EXECUTE FUNCTION production.guard_order_ownership_insert();
