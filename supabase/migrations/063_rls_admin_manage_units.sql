-- ============================================================================
-- Migration 063: Permitir admin gerenciar units, tenants e user_units
--
-- A migration 062 criou apenas policies de SELECT nessas tabelas.
-- Admins precisam de INSERT/UPDATE/DELETE para criar novas unidades,
-- vincular usuários etc.
-- ============================================================================

-- ── UNITS: admin pode criar, editar e excluir ──────────────────────────────

CREATE POLICY "admin_units_insert" ON units
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND perfil = 'admin'
    )
  );

CREATE POLICY "admin_units_update" ON units
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND perfil = 'admin'
    )
  );

CREATE POLICY "admin_units_delete" ON units
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND perfil = 'admin'
    )
  );

-- ── TENANTS: admin pode criar e editar ─────────────────────────────────────

CREATE POLICY "admin_tenants_insert" ON tenants
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND perfil = 'admin'
    )
  );

CREATE POLICY "admin_tenants_update" ON tenants
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND perfil = 'admin'
    )
  );

-- ── USER_UNITS: admin pode vincular/desvincular usuários a unidades ────────

CREATE POLICY "admin_user_units_insert" ON user_units
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND perfil = 'admin'
    )
  );

CREATE POLICY "admin_user_units_delete" ON user_units
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND perfil = 'admin'
    )
  );
