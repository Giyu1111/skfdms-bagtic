-- ============================================================
-- SK-FDMS: Sangguniang Kabataan Full Disclosure Management System
-- Barangay Bagtic, Balilihan, Bohol
-- Database Migration: 001_create_tables.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS skfdms_bagtic
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE skfdms_bagtic;

-- ─────────────────────────────────────────────────────────
-- TABLE: barangays
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS barangays (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  municipality VARCHAR(100) NOT NULL,
  province    VARCHAR(100) NOT NULL,
  region      VARCHAR(100) DEFAULT 'Region VII - Central Visayas',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────
-- TABLE: users  (SK officials)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  barangay_id   INT NOT NULL,
  name          VARCHAR(150) NOT NULL,
  email         VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('chairperson','treasurer','secretary','admin') NOT NULL,
  is_active     TINYINT(1) DEFAULT 1,
  last_login    TIMESTAMP NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (barangay_id) REFERENCES barangays(id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────────────────────
-- TABLE: categories  (DILG disclosure types)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(20) UNIQUE NOT NULL,
  name        VARCHAR(200) NOT NULL,
  description TEXT,
  is_required TINYINT(1) DEFAULT 1,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────
-- TABLE: documents
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  barangay_id     INT NOT NULL,
  category_id     INT NOT NULL,
  uploaded_by     INT NOT NULL,
  title           VARCHAR(300) NOT NULL,
  description     TEXT,
  file_path       VARCHAR(500) NOT NULL,
  file_name       VARCHAR(255) NOT NULL,
  file_type       VARCHAR(50) NOT NULL,
  file_size_kb    INT NOT NULL,
  fiscal_year     YEAR NOT NULL,
  quarter         ENUM('Q1','Q2','Q3','Q4','Annual') DEFAULT 'Annual',
  is_published    TINYINT(1) DEFAULT 0,
  published_at    TIMESTAMP NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (barangay_id)  REFERENCES barangays(id)  ON DELETE CASCADE,
  FOREIGN KEY (category_id)  REFERENCES categories(id) ON DELETE RESTRICT,
  FOREIGN KEY (uploaded_by)  REFERENCES users(id)      ON DELETE RESTRICT
);

-- ─────────────────────────────────────────────────────────
-- TABLE: activity_logs
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_logs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT,
  action      VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id   INT,
  details     TEXT,
  ip_address  VARCHAR(45),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ─────────────────────────────────────────────────────────
-- TABLE: announcements
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  barangay_id INT NOT NULL,
  created_by  INT NOT NULL,
  title       VARCHAR(300) NOT NULL,
  body        TEXT NOT NULL,
  is_active   TINYINT(1) DEFAULT 1,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (barangay_id) REFERENCES barangays(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by)  REFERENCES users(id) ON DELETE RESTRICT
);

-- ─────────────────────────────────────────────────────────
-- TABLE: sessions  (server-side session store)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id          VARCHAR(128) PRIMARY KEY,
  user_id     INT,
  ip_address  VARCHAR(45),
  user_agent  TEXT,
  payload     TEXT NOT NULL,
  expires_at  TIMESTAMP NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
