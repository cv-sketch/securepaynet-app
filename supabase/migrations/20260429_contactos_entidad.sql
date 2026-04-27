-- supabase/migrations/20260429_contactos_entidad.sql
-- Plan 3 Task 1: agregar columna entidad y reforzar UNIQUE(cliente_id, cvu)

ALTER TABLE contactos ADD COLUMN IF NOT EXISTS entidad TEXT;

-- El esquema previo (20260427_contactos.sql) creo el indice unico
-- contactos_cliente_cvu_unique como un partial unique INDEX (no constraint).
-- Lo reemplazamos por una UNIQUE constraint full-row sobre (cliente_id, cvu).
DROP INDEX IF EXISTS contactos_cliente_cvu_unique;
ALTER TABLE contactos
  DROP CONSTRAINT IF EXISTS contactos_cliente_cvu_unique;
ALTER TABLE contactos
  ADD CONSTRAINT contactos_cliente_cvu_unique UNIQUE (cliente_id, cvu);

UPDATE contactos
SET entidad = CASE
  WHEN cvu LIKE '0000003%' THEN 'Mercado Pago'
  WHEN cvu LIKE '0000019%' THEN 'Personal Pay'
  WHEN cvu LIKE '0000044%' THEN 'Naranja X'
  WHEN cvu LIKE '0000054%' THEN 'Ualá'
  WHEN cvu LIKE '0000086%' THEN 'Lemon'
  WHEN cvu LIKE '0000094%' THEN 'Belo'
  WHEN substring(cvu, 1, 3) IN ('005','007') THEN 'Banco Galicia'
  WHEN substring(cvu, 1, 3) = '011' THEN 'Banco Nación'
  WHEN substring(cvu, 1, 3) = '014' THEN 'Banco Provincia'
  WHEN substring(cvu, 1, 3) = '015' THEN 'ICBC'
  WHEN substring(cvu, 1, 3) = '017' THEN 'BBVA'
  WHEN substring(cvu, 1, 3) = '027' THEN 'Supervielle'
  WHEN substring(cvu, 1, 3) = '029' THEN 'Banco Ciudad'
  WHEN substring(cvu, 1, 3) = '034' THEN 'Banco Patagonia'
  WHEN substring(cvu, 1, 3) = '044' THEN 'Banco Hipotecario'
  WHEN substring(cvu, 1, 3) = '072' THEN 'Santander'
  WHEN substring(cvu, 1, 3) = '143' THEN 'Brubank'
  WHEN substring(cvu, 1, 3) = '150' THEN 'HSBC'
  WHEN substring(cvu, 1, 3) = '191' THEN 'Credicoop'
  WHEN substring(cvu, 1, 3) = '259' THEN 'Itaú'
  WHEN substring(cvu, 1, 3) = '285' THEN 'Macro'
  WHEN substring(cvu, 1, 3) = '299' THEN 'Comafi'
  WHEN substring(cvu, 1, 3) = '384' THEN 'Wilobank'
  WHEN substring(cvu, 1, 3) = '389' THEN 'Banco de Comercio'
  ELSE 'Otra entidad'
END
WHERE entidad IS NULL AND cvu IS NOT NULL;
