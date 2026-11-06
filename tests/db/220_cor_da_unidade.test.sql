DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.units WHERE cor IS NULL) THEN
    RAISE EXCEPTION 'a 139 deveria dar cor a toda unidade existente';
  END IF;
  IF (SELECT count(DISTINCT cor) FROM public.units WHERE id::text LIKE '00000000-0000-4000-8139-%') <> 3 THEN
    RAISE EXCEPTION 'as três unidades de dados_antes_139 deveriam ter cores diferentes';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    UPDATE public.units SET cor = 'verde' WHERE id = '00000000-0000-4000-8139-0000000000a0';
    RAISE EXCEPTION 'cor fora do formato #RRGGBB deveria ser recusada';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.units SET cor = '#AbCdEf' WHERE id = '00000000-0000-4000-8139-0000000000a0';
  INSERT INTO public.units (id, tenant_id, nome, tipo)
  VALUES ('00000000-0000-4000-8139-0000000000d0', '00000000-0000-4000-8139-0000000000f0', 'Unidade nova', 'clinica');
  IF (SELECT cor FROM public.units WHERE id = '00000000-0000-4000-8139-0000000000d0') IS NOT NULL THEN
    RAISE EXCEPTION 'unidade nova nasce sem cor (o app usa a paleta pela posição)';
  END IF;
END $$;
