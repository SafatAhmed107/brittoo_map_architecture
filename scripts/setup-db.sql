-- ==============================================================================
-- BUET Cycle / Tuition Media Map System: PostGIS Schema & Stored Procedures
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/trehuarcxjenzgyykobh/sql/new
-- ==============================================================================

-- 1. Enable PostGIS Extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Drop existing table if needed to update schema
-- DROP TABLE IF EXISTS tuition_posts CASCADE;

-- 3. Tuition Posts Table
CREATE TABLE IF NOT EXISTS tuition_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guardian_name VARCHAR(100) DEFAULT 'Guardian',
    contact_number VARCHAR(30) DEFAULT '01700000000',
    class_level VARCHAR(50) NOT NULL,
    subjects TEXT[] NOT NULL,
    salary_budget NUMERIC(10, 2) NOT NULL,
    notes TEXT,
    thana_name TEXT NOT NULL,
    district_name TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    -- Automatically computed PostGIS Point geometry from lat/lng
    location GEOMETRY(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED,
    status VARCHAR(20) DEFAULT 'OPEN',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial GIST Index for O(log N) proximity search & MVT generation
CREATE INDEX IF NOT EXISTS idx_tuition_posts_location ON tuition_posts USING GIST(location);
-- Partial index: only index OPEN posts (90% of queries filter on this)
CREATE INDEX IF NOT EXISTS idx_tuition_posts_status ON tuition_posts (status) WHERE status = 'OPEN';
-- Composite index for thana-level non-map queries
CREATE INDEX IF NOT EXISTS idx_tuition_posts_thana ON tuition_posts (thana_name, district_name);

-- 4. Enable Row Level Security (RLS) & Policies
ALTER TABLE tuition_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access" 
ON tuition_posts FOR SELECT 
USING (true);

CREATE POLICY "Allow public insert access" 
ON tuition_posts FOR INSERT 
WITH CHECK (true);

-- 5. PostGIS High-Speed MVT Vector Tile Generator (C-Speed at Edge)
CREATE OR REPLACE FUNCTION get_tuition_tile(z integer, x integer, y integer)
RETURNS bytea AS $$
DECLARE
    mvt bytea;
BEGIN
    WITH bbox AS (
        -- Calculate geographic bounding box for the slippy tile (z, x, y) in Web Mercator (3857)
        SELECT ST_TileEnvelope(z, x, y) AS geom
    ),
    mvtdata AS (
        SELECT 
            t.id,
            t.guardian_name,
            t.class_level,
            t.salary_budget,
            t.subjects,
            t.thana_name,
            t.district_name,
            ST_AsMVTGeom(ST_Transform(t.location, 3857), bbox.geom, 4096, 64, true) AS geom
        FROM tuition_posts t, bbox
        WHERE t.status = 'OPEN'
          AND ST_Intersects(ST_Transform(t.location, 3857), bbox.geom)
    )
    SELECT ST_AsMVT(mvtdata.*, 'tuition_layer', 4096, 'geom') INTO mvt FROM mvtdata;
    
    RETURN mvt;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

-- 6. Insert Starter Tuition Seeds around BUET, DU, Dhanmondi, Mirpur
INSERT INTO tuition_posts (guardian_name, contact_number, class_level, subjects, salary_budget, thana_name, district_name, lat, lng, notes)
VALUES
  ('Engr. Rahman', '01711-234567', 'HSC 2nd Year', ARRAY['Physics', 'Higher Math'], 8500.00, 'Lalbagh', 'Dhaka', 23.7266, 90.3924, 'Near BUET Palashi Gate. Seeking BUET engineering tutor for admission preparation.'),
  ('Dr. Sultana', '01819-876543', 'SSC (Class 10)', ARRAY['General Math', 'Physics', 'Chemistry'], 7000.00, 'Shahbagh', 'Dhaka', 23.7275, 90.4019, 'Near Curzon Hall / High Court. 3 days a week, evening 6:00 PM.'),
  ('Mrs. Nusrat', '01912-345678', 'Class 8 (JSC)', ARRAY['All Science Subjects', 'English'], 6000.00, 'Dhanmondi', 'Dhaka', 23.7533, 90.3725, 'Dhanmondi 27 near Rapa Plaza. Friendly tutor preferred.'),
  ('Prof. Hasan', '01678-901234', 'HSC 1st Year', ARRAY['Chemistry', 'Biology'], 7500.00, 'Tejgaon', 'Dhaka', 23.7571, 90.3888, 'Near Farmgate Metro Station / Indira Road. 4 days a week.'),
  ('Md. Tariqul Islam', '01552-334455', 'HSC 2nd Year', ARRAY['Physics', 'ICT'], 7000.00, 'Mirpur', 'Dhaka', 23.8071, 90.3697, 'Near Mirpur 10 Roundabout. Looking for someone strong in electromagnetism.')
ON CONFLICT DO NOTHING;
