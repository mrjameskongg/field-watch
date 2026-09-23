
-- Create enums
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'field_officer');
CREATE TYPE public.farmer_status AS ENUM ('active', 'inactive', 'suspended');
CREATE TYPE public.contract_status AS ENUM ('active', 'pending', 'expired', 'terminated');
CREATE TYPE public.farm_status AS ENUM ('active', 'inactive', 'fallow', 'harvested');
CREATE TYPE public.risk_level AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE public.crop_type AS ENUM ('rice', 'cassava', 'corn', 'sugarcane', 'rubber', 'pepper', 'vegetable', 'fruit', 'other');
CREATE TYPE public.visit_type AS ENUM ('routine', 'follow_up', 'emergency', 'initial');
CREATE TYPE public.alert_type AS ENUM ('water_stress', 'possible_burn', 'low_vegetation', 'manual_flag');
CREATE TYPE public.alert_source AS ENUM ('manual', 'satellite_api', 'field_visit');
CREATE TYPE public.alert_status AS ENUM ('new', 'investigating', 'resolved', 'dismissed');
CREATE TYPE public.severity_level AS ENUM ('low', 'medium', 'high', 'critical');

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  active_status BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- User roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- has_role security definer function
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Farmers table
CREATE TABLE public.farmers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  gender TEXT,
  date_of_birth DATE,
  phone_number TEXT,
  secondary_phone TEXT,
  national_id_or_reference TEXT,
  village TEXT,
  commune TEXT,
  district TEXT,
  province TEXT,
  crop_type crop_type DEFAULT 'rice',
  status farmer_status NOT NULL DEFAULT 'active',
  contract_status contract_status DEFAULT 'pending',
  registration_date DATE DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.farmers ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_farmers_updated_at
  BEFORE UPDATE ON public.farmers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Farms table
CREATE TABLE public.farms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_code TEXT NOT NULL UNIQUE,
  farmer_id UUID NOT NULL REFERENCES public.farmers(id) ON DELETE CASCADE,
  farm_name TEXT NOT NULL,
  province TEXT,
  district TEXT,
  commune TEXT,
  village TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  area_hectares DOUBLE PRECISION,
  crop_type crop_type DEFAULT 'rice',
  planting_date DATE,
  status farm_status NOT NULL DEFAULT 'active',
  risk_level risk_level DEFAULT 'low',
  notes TEXT,
  boundary_geojson JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.farms ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_farms_updated_at
  BEFORE UPDATE ON public.farms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Field visits table
CREATE TABLE public.field_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  farmer_id UUID NOT NULL REFERENCES public.farmers(id) ON DELETE CASCADE,
  field_officer_id UUID REFERENCES auth.users(id),
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  visit_type visit_type NOT NULL DEFAULT 'routine',
  crop_condition TEXT,
  water_condition TEXT,
  burn_signs_observed BOOLEAN DEFAULT false,
  pest_or_disease_observed BOOLEAN DEFAULT false,
  comments TEXT,
  next_action TEXT,
  next_visit_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.field_visits ENABLE ROW LEVEL SECURITY;

-- Alerts table
CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID REFERENCES public.farms(id) ON DELETE SET NULL,
  farmer_id UUID REFERENCES public.farmers(id) ON DELETE SET NULL,
  alert_type alert_type NOT NULL,
  severity severity_level NOT NULL DEFAULT 'medium',
  source alert_source NOT NULL DEFAULT 'manual',
  status alert_status NOT NULL DEFAULT 'new',
  detected_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_date TIMESTAMPTZ,
  description TEXT,
  recommended_action TEXT,
  assigned_to UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_alerts_updated_at
  BEFORE UPDATE ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Files table
CREATE TABLE public.files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT,
  file_size BIGINT,
  farmer_id UUID REFERENCES public.farmers(id) ON DELETE CASCADE,
  farm_id UUID REFERENCES public.farms(id) ON DELETE CASCADE,
  field_visit_id UUID REFERENCES public.field_visits(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

-- App settings table
CREATE TABLE public.app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS Policies

-- Profiles
CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- User roles
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can view roles" ON public.user_roles FOR SELECT TO authenticated USING (true);

-- Farmers
CREATE POLICY "Authenticated users can view farmers" ON public.farmers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert farmers" ON public.farmers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update farmers" ON public.farmers FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Admins can delete farmers" ON public.farmers FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

-- Farms
CREATE POLICY "Authenticated users can view farms" ON public.farms FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert farms" ON public.farms FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update farms" ON public.farms FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Admins/managers can delete farms" ON public.farms FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

-- Field visits
CREATE POLICY "Authenticated users can view visits" ON public.field_visits FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert visits" ON public.field_visits FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update visits" ON public.field_visits FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Admins/managers can delete visits" ON public.field_visits FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

-- Alerts
CREATE POLICY "Authenticated users can view alerts" ON public.alerts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert alerts" ON public.alerts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update alerts" ON public.alerts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Admins/managers can delete alerts" ON public.alerts FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

-- Files
CREATE POLICY "Authenticated users can view files" ON public.files FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert files" ON public.files FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can delete own files" ON public.files FOR DELETE TO authenticated USING (uploaded_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- App settings
CREATE POLICY "Authenticated users can view settings" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage settings" ON public.app_settings FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('farmer-documents', 'farmer-documents', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('farm-photos', 'farm-photos', true);
INSERT INTO storage.buckets (id, name, public) VALUES ('visit-photos', 'visit-photos', true);

-- Storage policies
CREATE POLICY "Authenticated can upload farmer docs" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'farmer-documents');
CREATE POLICY "Authenticated can view farmer docs" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'farmer-documents');
CREATE POLICY "Authenticated can delete farmer docs" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'farmer-documents');

CREATE POLICY "Authenticated can upload farm photos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'farm-photos');
CREATE POLICY "Anyone can view farm photos" ON storage.objects FOR SELECT USING (bucket_id = 'farm-photos');
CREATE POLICY "Authenticated can delete farm photos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'farm-photos');

CREATE POLICY "Authenticated can upload visit photos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'visit-photos');
CREATE POLICY "Anyone can view visit photos" ON storage.objects FOR SELECT USING (bucket_id = 'visit-photos');
CREATE POLICY "Authenticated can delete visit photos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'visit-photos');

-- Indexes
CREATE INDEX idx_farmers_province ON public.farmers(province);
CREATE INDEX idx_farmers_status ON public.farmers(status);
CREATE INDEX idx_farmers_crop_type ON public.farmers(crop_type);
CREATE INDEX idx_farms_farmer_id ON public.farms(farmer_id);
CREATE INDEX idx_farms_province ON public.farms(province);
CREATE INDEX idx_farms_status ON public.farms(status);
CREATE INDEX idx_farms_risk_level ON public.farms(risk_level);
CREATE INDEX idx_field_visits_farm_id ON public.field_visits(farm_id);
CREATE INDEX idx_field_visits_farmer_id ON public.field_visits(farmer_id);
CREATE INDEX idx_field_visits_visit_date ON public.field_visits(visit_date);
CREATE INDEX idx_alerts_farm_id ON public.alerts(farm_id);
CREATE INDEX idx_alerts_farmer_id ON public.alerts(farmer_id);
CREATE INDEX idx_alerts_status ON public.alerts(status);
CREATE INDEX idx_alerts_alert_type ON public.alerts(alert_type);
CREATE INDEX idx_files_farmer_id ON public.files(farmer_id);
CREATE INDEX idx_files_farm_id ON public.files(farm_id);
