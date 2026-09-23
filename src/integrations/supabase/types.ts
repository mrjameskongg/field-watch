export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          actor_roles: string | null
          at: string
          changes: Json
          demo_visible: boolean
          id: number
          row_id: string | null
          row_label: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          actor_roles?: string | null
          at?: string
          changes?: Json
          demo_visible?: boolean
          id?: never
          row_id?: string | null
          row_label?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          actor_roles?: string | null
          at?: string
          changes?: Json
          demo_visible?: boolean
          id?: never
          row_id?: string | null
          row_label?: string | null
          table_name?: string
        }
        Relationships: []
      }
      alerts: {
        Row: {
          alert_type: Database["public"]["Enums"]["alert_type"]
          assigned_to: string | null
          created_at: string
          description: string | null
          detected_date: string
          farm_id: string | null
          farmer_id: string | null
          id: string
          recommended_action: string | null
          resolved_date: string | null
          severity: Database["public"]["Enums"]["severity_level"]
          source: Database["public"]["Enums"]["alert_source"]
          status: Database["public"]["Enums"]["alert_status"]
          updated_at: string
        }
        Insert: {
          alert_type: Database["public"]["Enums"]["alert_type"]
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          detected_date?: string
          farm_id?: string | null
          farmer_id?: string | null
          id?: string
          recommended_action?: string | null
          resolved_date?: string | null
          severity?: Database["public"]["Enums"]["severity_level"]
          source?: Database["public"]["Enums"]["alert_source"]
          status?: Database["public"]["Enums"]["alert_status"]
          updated_at?: string
        }
        Update: {
          alert_type?: Database["public"]["Enums"]["alert_type"]
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          detected_date?: string
          farm_id?: string | null
          farmer_id?: string | null
          id?: string
          recommended_action?: string | null
          resolved_date?: string | null
          severity?: Database["public"]["Enums"]["severity_level"]
          source?: Database["public"]["Enums"]["alert_source"]
          status?: Database["public"]["Enums"]["alert_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_farmer_id_fkey"
            columns: ["farmer_id"]
            isOneToOne: false
            referencedRelation: "farmers"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      batch_weigh_points: {
        Row: {
          bag_count: number | null
          batch_id: string
          created_at: string
          estimated: boolean
          id: string
          kg_per_bag: number | null
          moisture_pct: number | null
          notes: string | null
          recorded_by: string | null
          recorded_date: string
          stage: string
          weight_kg: number
        }
        Insert: {
          bag_count?: number | null
          batch_id: string
          created_at?: string
          estimated?: boolean
          id?: string
          kg_per_bag?: number | null
          moisture_pct?: number | null
          notes?: string | null
          recorded_by?: string | null
          recorded_date?: string
          stage: string
          weight_kg: number
        }
        Update: {
          bag_count?: number | null
          batch_id?: string
          created_at?: string
          estimated?: boolean
          id?: string
          kg_per_bag?: number | null
          moisture_pct?: number | null
          notes?: string | null
          recorded_by?: string | null
          recorded_date?: string
          stage?: string
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "batch_weigh_points_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
        ]
      }
      batches: {
        Row: {
          batch_code: string
          created_at: string
          created_date: string
          crop_type: string
          custody_model: string
          dryer: string | null
          id: string
          notes: string | null
          status: string
          storage_location: string | null
          updated_at: string
          variety: string | null
        }
        Insert: {
          batch_code: string
          created_at?: string
          created_date?: string
          crop_type?: string
          custody_model?: string
          dryer?: string | null
          id?: string
          notes?: string | null
          status?: string
          storage_location?: string | null
          updated_at?: string
          variety?: string | null
        }
        Update: {
          batch_code?: string
          created_at?: string
          created_date?: string
          crop_type?: string
          custody_model?: string
          dryer?: string | null
          id?: string
          notes?: string | null
          status?: string
          storage_location?: string | null
          updated_at?: string
          variety?: string | null
        }
        Relationships: []
      }
      buyers: {
        Row: {
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      contracts: {
        Row: {
          contract_code: string
          contracted_hectares: number | null
          created_at: string
          crop_type: string
          currency: string
          expected_yield_kg: number | null
          farm_id: string | null
          farmer_id: string
          fixed_price_per_kg: number | null
          grower_type: string
          id: string
          notes: string | null
          price_mode: string
          season_closed: boolean
          season_label: string
          signed_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          contract_code: string
          contracted_hectares?: number | null
          created_at?: string
          crop_type?: string
          currency?: string
          expected_yield_kg?: number | null
          farm_id?: string | null
          farmer_id: string
          fixed_price_per_kg?: number | null
          grower_type?: string
          id?: string
          notes?: string | null
          price_mode?: string
          season_closed?: boolean
          season_label: string
          signed_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          contract_code?: string
          contracted_hectares?: number | null
          created_at?: string
          crop_type?: string
          currency?: string
          expected_yield_kg?: number | null
          farm_id?: string | null
          farmer_id?: string
          fixed_price_per_kg?: number | null
          grower_type?: string
          id?: string
          notes?: string | null
          price_mode?: string
          season_closed?: boolean
          season_label?: string
          signed_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_farmer_id_fkey"
            columns: ["farmer_id"]
            isOneToOne: false
            referencedRelation: "farmers"
            referencedColumns: ["id"]
          },
        ]
      }
      crop_cycles: {
        Row: {
          created_at: string
          crop_type: Database["public"]["Enums"]["crop_type"] | null
          expected_harvest_date: string | null
          farm_id: string
          harvest_date: string | null
          id: string
          notes: string | null
          planting_date: string
          season_label: string
          seed_variety: string | null
          status: string
          yield_kg: number | null
        }
        Insert: {
          created_at?: string
          crop_type?: Database["public"]["Enums"]["crop_type"] | null
          expected_harvest_date?: string | null
          farm_id: string
          harvest_date?: string | null
          id?: string
          notes?: string | null
          planting_date: string
          season_label: string
          seed_variety?: string | null
          status?: string
          yield_kg?: number | null
        }
        Update: {
          created_at?: string
          crop_type?: Database["public"]["Enums"]["crop_type"] | null
          expected_harvest_date?: string | null
          farm_id?: string
          harvest_date?: string | null
          id?: string
          notes?: string | null
          planting_date?: string
          season_label?: string
          seed_variety?: string | null
          status?: string
          yield_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "crop_cycles_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          bag_count: number | null
          batch_id: string | null
          contract_id: string
          created_at: string
          delivery_code: string
          grade: string | null
          gross_weight_kg: number
          id: string
          moisture_flagged: boolean | null
          moisture_pct: number | null
          price_per_kg_applied: number
          price_source: string
          quality_notes: string | null
          received_by: string | null
          received_date: string
          settlement_id: string | null
          variety: string | null
        }
        Insert: {
          bag_count?: number | null
          batch_id?: string | null
          contract_id: string
          created_at?: string
          delivery_code: string
          grade?: string | null
          gross_weight_kg: number
          id?: string
          moisture_flagged?: boolean | null
          moisture_pct?: number | null
          price_per_kg_applied?: number
          price_source?: string
          quality_notes?: string | null
          received_by?: string | null
          received_date?: string
          settlement_id?: string | null
          variety?: string | null
        }
        Update: {
          bag_count?: number | null
          batch_id?: string | null
          contract_id?: string
          created_at?: string
          delivery_code?: string
          grade?: string | null
          gross_weight_kg?: number
          id?: string
          moisture_flagged?: boolean | null
          moisture_pct?: number | null
          price_per_kg_applied?: number
          price_source?: string
          quality_notes?: string | null
          received_by?: string | null
          received_date?: string
          settlement_id?: string | null
          variety?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatches: {
        Row: {
          buyer_id: string
          created_at: string
          dispatch_code: string
          dispatched_date: string
          id: string
          notes: string | null
          price_per_kg: number | null
          product: string
          recorded_by: string | null
          weight_kg: number
        }
        Insert: {
          buyer_id: string
          created_at?: string
          dispatch_code: string
          dispatched_date?: string
          id?: string
          notes?: string | null
          price_per_kg?: number | null
          product: string
          recorded_by?: string | null
          weight_kg: number
        }
        Update: {
          buyer_id?: string
          created_at?: string
          dispatch_code?: string
          dispatched_date?: string
          id?: string
          notes?: string | null
          price_per_kg?: number | null
          product?: string
          recorded_by?: string | null
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "dispatches_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "buyers"
            referencedColumns: ["id"]
          },
        ]
      }
      farmers: {
        Row: {
          certifications: string | null
          commune: string | null
          contract_status: Database["public"]["Enums"]["contract_status"] | null
          created_at: string
          crop_type: Database["public"]["Enums"]["crop_type"] | null
          date_of_birth: string | null
          district: string | null
          farmer_code: string
          full_name: string
          gender: string | null
          id: string
          labor_notes: string | null
          national_id_or_reference: string | null
          notes: string | null
          phone_number: string | null
          province: string | null
          registration_date: string | null
          secondary_phone: string | null
          status: Database["public"]["Enums"]["farmer_status"]
          updated_at: string
          village: string | null
        }
        Insert: {
          certifications?: string | null
          commune?: string | null
          contract_status?:
            | Database["public"]["Enums"]["contract_status"]
            | null
          created_at?: string
          crop_type?: Database["public"]["Enums"]["crop_type"] | null
          date_of_birth?: string | null
          district?: string | null
          farmer_code: string
          full_name: string
          gender?: string | null
          id?: string
          labor_notes?: string | null
          national_id_or_reference?: string | null
          notes?: string | null
          phone_number?: string | null
          province?: string | null
          registration_date?: string | null
          secondary_phone?: string | null
          status?: Database["public"]["Enums"]["farmer_status"]
          updated_at?: string
          village?: string | null
        }
        Update: {
          certifications?: string | null
          commune?: string | null
          contract_status?:
            | Database["public"]["Enums"]["contract_status"]
            | null
          created_at?: string
          crop_type?: Database["public"]["Enums"]["crop_type"] | null
          date_of_birth?: string | null
          district?: string | null
          farmer_code?: string
          full_name?: string
          gender?: string | null
          id?: string
          labor_notes?: string | null
          national_id_or_reference?: string | null
          notes?: string | null
          phone_number?: string | null
          province?: string | null
          registration_date?: string | null
          secondary_phone?: string | null
          status?: Database["public"]["Enums"]["farmer_status"]
          updated_at?: string
          village?: string | null
        }
        Relationships: []
      }
      farms: {
        Row: {
          area_hectares: number | null
          boundary_geojson: Json | null
          commune: string | null
          created_at: string
          crop_type: Database["public"]["Enums"]["crop_type"] | null
          district: string | null
          farm_code: string
          farm_name: string
          farmer_id: string
          id: string
          land_tenure: string | null
          land_tenure_ref: string | null
          latitude: number | null
          longitude: number | null
          notes: string | null
          planting_date: string | null
          province: string | null
          risk_level: Database["public"]["Enums"]["risk_level"] | null
          status: Database["public"]["Enums"]["farm_status"]
          updated_at: string
          village: string | null
        }
        Insert: {
          area_hectares?: number | null
          boundary_geojson?: Json | null
          commune?: string | null
          created_at?: string
          crop_type?: Database["public"]["Enums"]["crop_type"] | null
          district?: string | null
          farm_code: string
          farm_name: string
          farmer_id: string
          id?: string
          land_tenure?: string | null
          land_tenure_ref?: string | null
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          planting_date?: string | null
          province?: string | null
          risk_level?: Database["public"]["Enums"]["risk_level"] | null
          status?: Database["public"]["Enums"]["farm_status"]
          updated_at?: string
          village?: string | null
        }
        Update: {
          area_hectares?: number | null
          boundary_geojson?: Json | null
          commune?: string | null
          created_at?: string
          crop_type?: Database["public"]["Enums"]["crop_type"] | null
          district?: string | null
          farm_code?: string
          farm_name?: string
          farmer_id?: string
          id?: string
          land_tenure?: string | null
          land_tenure_ref?: string | null
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          planting_date?: string | null
          province?: string | null
          risk_level?: Database["public"]["Enums"]["risk_level"] | null
          status?: Database["public"]["Enums"]["farm_status"]
          updated_at?: string
          village?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "farms_farmer_id_fkey"
            columns: ["farmer_id"]
            isOneToOne: false
            referencedRelation: "farmers"
            referencedColumns: ["id"]
          },
        ]
      }
      field_events: {
        Row: {
          created_at: string
          cycle_id: string
          event_date: string
          event_type: string
          farm_id: string
          id: string
          note: string | null
          product: string | null
          quantity: number | null
          recorded_by: string | null
          unit: string | null
          visit_id: string | null
          water_depth_cm: number | null
          water_state: string | null
        }
        Insert: {
          created_at?: string
          cycle_id: string
          event_date?: string
          event_type: string
          farm_id: string
          id?: string
          note?: string | null
          product?: string | null
          quantity?: number | null
          recorded_by?: string | null
          unit?: string | null
          visit_id?: string | null
          water_depth_cm?: number | null
          water_state?: string | null
        }
        Update: {
          created_at?: string
          cycle_id?: string
          event_date?: string
          event_type?: string
          farm_id?: string
          id?: string
          note?: string | null
          product?: string | null
          quantity?: number | null
          recorded_by?: string | null
          unit?: string | null
          visit_id?: string | null
          water_depth_cm?: number | null
          water_state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "field_events_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "crop_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_events_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_events_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "field_visits"
            referencedColumns: ["id"]
          },
        ]
      }
      field_visits: {
        Row: {
          burn_signs_observed: boolean | null
          comments: string | null
          created_at: string
          crop_condition: string | null
          farm_id: string
          farmer_id: string
          field_officer_id: string | null
          id: string
          next_action: string | null
          next_visit_date: string | null
          pest_or_disease_observed: boolean | null
          visit_date: string
          visit_type: Database["public"]["Enums"]["visit_type"]
          water_condition: string | null
        }
        Insert: {
          burn_signs_observed?: boolean | null
          comments?: string | null
          created_at?: string
          crop_condition?: string | null
          farm_id: string
          farmer_id: string
          field_officer_id?: string | null
          id?: string
          next_action?: string | null
          next_visit_date?: string | null
          pest_or_disease_observed?: boolean | null
          visit_date?: string
          visit_type?: Database["public"]["Enums"]["visit_type"]
          water_condition?: string | null
        }
        Update: {
          burn_signs_observed?: boolean | null
          comments?: string | null
          created_at?: string
          crop_condition?: string | null
          farm_id?: string
          farmer_id?: string
          field_officer_id?: string | null
          id?: string
          next_action?: string | null
          next_visit_date?: string | null
          pest_or_disease_observed?: boolean | null
          visit_date?: string
          visit_type?: Database["public"]["Enums"]["visit_type"]
          water_condition?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "field_visits_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_visits_farmer_id_fkey"
            columns: ["farmer_id"]
            isOneToOne: false
            referencedRelation: "farmers"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          created_at: string
          farm_id: string | null
          farmer_id: string | null
          field_visit_id: string | null
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          farm_id?: string | null
          farmer_id?: string | null
          field_visit_id?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          farm_id?: string | null
          farmer_id?: string | null
          field_visit_id?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "files_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_farmer_id_fkey"
            columns: ["farmer_id"]
            isOneToOne: false
            referencedRelation: "farmers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_field_visit_id_fkey"
            columns: ["field_visit_id"]
            isOneToOne: false
            referencedRelation: "field_visits"
            referencedColumns: ["id"]
          },
        ]
      }
      input_advances: {
        Row: {
          contract_id: string
          created_at: string
          date_issued: string
          deduct_at_settlement: boolean
          description: string | null
          id: string
          item_type: string
          quantity: number | null
          settlement_id: string | null
          total_cost: number
          unit: string | null
          unit_cost: number | null
        }
        Insert: {
          contract_id: string
          created_at?: string
          date_issued?: string
          deduct_at_settlement?: boolean
          description?: string | null
          id?: string
          item_type?: string
          quantity?: number | null
          settlement_id?: string | null
          total_cost?: number
          unit?: string | null
          unit_cost?: number | null
        }
        Update: {
          contract_id?: string
          created_at?: string
          date_issued?: string
          deduct_at_settlement?: boolean
          description?: string | null
          id?: string
          item_type?: string
          quantity?: number | null
          settlement_id?: string | null
          total_cost?: number
          unit?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "input_advances_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "input_advances_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      market_prices: {
        Row: {
          created_at: string
          crop_type: string
          id: string
          price_date: string
          price_per_kg: number
          source: string | null
        }
        Insert: {
          created_at?: string
          crop_type?: string
          id?: string
          price_date: string
          price_per_kg: number
          source?: string | null
        }
        Update: {
          created_at?: string
          crop_type?: string
          id?: string
          price_date?: string
          price_per_kg?: number
          source?: string | null
        }
        Relationships: []
      }
      parcel_health: {
        Row: {
          cloud_pct: number
          created_at: string
          farm_id: string
          id: string
          ndmi_mean: number
          ndvi_mean: number
          reading_date: string
        }
        Insert: {
          cloud_pct?: number
          created_at?: string
          farm_id: string
          id?: string
          ndmi_mean: number
          ndvi_mean: number
          reading_date: string
        }
        Update: {
          cloud_pct?: number
          created_at?: string
          farm_id?: string
          id?: string
          ndmi_mean?: number
          ndvi_mean?: number
          reading_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "parcel_health_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
        ]
      }
      parcel_water: {
        Row: {
          confident: boolean
          created_at: string
          farm_id: string
          id: string
          reading_date: string
          state: string
          vh_db: number
          vv_db: number
        }
        Insert: {
          confident?: boolean
          created_at?: string
          farm_id: string
          id?: string
          reading_date: string
          state: string
          vh_db: number
          vv_db: number
        }
        Update: {
          confident?: boolean
          created_at?: string
          farm_id?: string
          id?: string
          reading_date?: string
          state?: string
          vh_db?: number
          vv_db?: number
        }
        Relationships: [
          {
            foreignKeyName: "parcel_water_farm_id_fkey"
            columns: ["farm_id"]
            isOneToOne: false
            referencedRelation: "farms"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_status: boolean
          created_at: string
          email: string
          full_name: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active_status?: boolean
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active_status?: boolean
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      qc_tests: {
        Row: {
          batch_id: string | null
          created_at: string
          delivery_id: string | null
          id: string
          method: string | null
          passed: boolean | null
          recorded_by: string | null
          result_text: string | null
          result_value: number | null
          test_type: string
          tested_by: string | null
          tested_date: string
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          delivery_id?: string | null
          id?: string
          method?: string | null
          passed?: boolean | null
          recorded_by?: string | null
          result_text?: string | null
          result_value?: number | null
          test_type?: string
          tested_by?: string | null
          tested_date?: string
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          delivery_id?: string | null
          id?: string
          method?: string | null
          passed?: boolean | null
          recorded_by?: string | null
          result_text?: string | null
          result_value?: number | null
          test_type?: string
          tested_by?: string | null
          tested_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "qc_tests_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qc_tests_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          contract_id: string
          created_at: string
          gross_value: number
          id: string
          net_payment: number
          notes: string | null
          payment_method: string | null
          payment_reference: string | null
          settled_date: string
          settlement_code: string
          status: string
          total_deductions: number
          updated_at: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          gross_value?: number
          id?: string
          net_payment?: number
          notes?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          settled_date?: string
          settlement_code: string
          status?: string
          total_deductions?: number
          updated_at?: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          gross_value?: number
          id?: string
          net_payment?: number
          notes?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          settled_date?: string
          settlement_code?: string
          status?: string
          total_deductions?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlements_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_alert_summary: {
        Row: {
          alert_count: number | null
          alert_type: Database["public"]["Enums"]["alert_type"] | null
          last_detected: string | null
          severity: Database["public"]["Enums"]["severity_level"] | null
          status: Database["public"]["Enums"]["alert_status"] | null
        }
        Relationships: []
      }
      v_area_by_province: {
        Row: {
          farm_count: number | null
          mapped_count: number | null
          province: string | null
          total_hectares: number | null
        }
        Relationships: []
      }
      v_delivery_by_season: {
        Row: {
          crop_type: string | null
          currency: string | null
          delivery_count: number | null
          season_closed: boolean | null
          season_label: string | null
          total_kg: number | null
          total_value: number | null
        }
        Relationships: []
      }
      v_settlement_summary: {
        Row: {
          currency: string | null
          draft_count: number | null
          gross_value: number | null
          net_payment: number | null
          paid_count: number | null
          season_label: string | null
          settlement_count: number | null
          total_deductions: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      alert_source: "manual" | "satellite_api" | "field_visit"
      alert_status: "new" | "investigating" | "resolved" | "dismissed"
      alert_type:
        | "water_stress"
        | "possible_burn"
        | "low_vegetation"
        | "manual_flag"
      app_role: "admin" | "manager" | "field_officer" | "warehouse" | "quality_officer"
      contract_status: "active" | "pending" | "expired" | "terminated"
      crop_type:
        | "rice"
        | "cassava"
        | "corn"
        | "sugarcane"
        | "rubber"
        | "pepper"
        | "vegetable"
        | "fruit"
        | "other"
      farm_status: "active" | "inactive" | "fallow" | "harvested"
      farmer_status: "active" | "inactive" | "suspended"
      risk_level: "low" | "medium" | "high" | "critical"
      severity_level: "low" | "medium" | "high" | "critical"
      visit_type: "routine" | "follow_up" | "emergency" | "initial"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      alert_source: ["manual", "satellite_api", "field_visit"],
      alert_status: ["new", "investigating", "resolved", "dismissed"],
      alert_type: [
        "water_stress",
        "possible_burn",
        "low_vegetation",
        "manual_flag",
      ],
      app_role: ["admin", "manager", "field_officer", "warehouse", "quality_officer"],
      contract_status: ["active", "pending", "expired", "terminated"],
      crop_type: [
        "rice",
        "cassava",
        "corn",
        "sugarcane",
        "rubber",
        "pepper",
        "vegetable",
        "fruit",
        "other",
      ],
      farm_status: ["active", "inactive", "fallow", "harvested"],
      farmer_status: ["active", "inactive", "suspended"],
      risk_level: ["low", "medium", "high", "critical"],
      severity_level: ["low", "medium", "high", "critical"],
      visit_type: ["routine", "follow_up", "emergency", "initial"],
    },
  },
} as const
