-- ============================================================
-- SK-FDMS Seeder: 002_seed_data.sql
-- Barangay Bagtic, Balilihan, Bohol
-- ============================================================

USE skfdms_bagtic;

-- ─── Barangay Bagtic ────────────────────────────────────
INSERT INTO barangays (name, municipality, province) VALUES
  ('Bagtic', 'Balilihan', 'Bohol');

-- ─── DILG Disclosure Categories ─────────────────────────
INSERT INTO categories (code, name, description, is_required) VALUES
  ('AIP',   'Annual Investment Plan',                    'Yearly investment plan for SK programs and projects',                            1),
  ('SRE',   'Statement of Receipts and Expenditures',   'Quarterly financial statement of all SK income and expenses',                    1),
  ('RES',   'SK Resolutions and Ordinances',            'Formal resolutions passed by the SK council',                                    1),
  ('PAR',   'Project Accomplishment Report',            'Report on completed SK programs and projects',                                   1),
  ('MOM',   'Minutes of Meetings',                      'Official minutes of SK council sessions',                                        1),
  ('SUP',   'Supplemental Budget',                      'Additional budget requests beyond the original annual plan',                     0),
  ('ACT',   'Activity and Event Reports',               'Reports for SK-organized events and youth activities',                           0),
  ('ABUD',  'Approved SK Budget',                       'The officially approved annual SK budget for the fiscal year',                   1),
  ('UDAI',  'Unliquidated Cash Advances Inventory',     'Report of all unliquidated cash advances of SK officials',                       1);

-- ─── Default Admin User (password: Admin@Bagtic2024) ────
-- bcrypt hash of "Admin@Bagtic2024"
INSERT INTO users (barangay_id, name, email, password_hash, role) VALUES
  (1, 'SK Admin Bagtic', 'admin@skbagtic.gov.ph',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGc2L5YwEnFMzBq2pCa.JZD6bAe', 'admin');
