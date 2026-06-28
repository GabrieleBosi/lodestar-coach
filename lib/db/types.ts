// Generated from the Supabase schema via the Supabase connector
// (equivalent to: `supabase gen types typescript`).
// Regenerate after schema changes — see README "Database" section.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      chunks: {
        Row: {
          content: string;
          content_hash: string | null;
          created_at: string;
          document_id: string;
          embedding: string | null;
          heading: string | null;
          id: string;
          metadata: Json;
          token_count: number | null;
          updated_at: string;
        };
        Insert: {
          content: string;
          content_hash?: string | null;
          created_at?: string;
          document_id: string;
          embedding?: string | null;
          heading?: string | null;
          id?: string;
          metadata?: Json;
          token_count?: number | null;
          updated_at?: string;
        };
        Update: {
          content?: string;
          content_hash?: string | null;
          created_at?: string;
          document_id?: string;
          embedding?: string | null;
          heading?: string | null;
          id?: string;
          metadata?: Json;
          token_count?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chunks_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          created_at: string;
          id: string;
          title: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          title?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          title?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      documents: {
        Row: {
          added_by: string | null;
          created_at: string;
          id: string;
          license: string | null;
          source_title: string | null;
          source_url: string | null;
          summary: string | null;
          updated_at: string;
        };
        Insert: {
          added_by?: string | null;
          created_at?: string;
          id?: string;
          license?: string | null;
          source_title?: string | null;
          source_url?: string | null;
          summary?: string | null;
          updated_at?: string;
        };
        Update: {
          added_by?: string | null;
          created_at?: string;
          id?: string;
          license?: string | null;
          source_title?: string | null;
          source_url?: string | null;
          summary?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      eval_runs: {
        Row: {
          commit_sha: string | null;
          created_at: string;
          dataset: string | null;
          id: string;
          metrics: Json | null;
          updated_at: string;
        };
        Insert: {
          commit_sha?: string | null;
          created_at?: string;
          dataset?: string | null;
          id?: string;
          metrics?: Json | null;
          updated_at?: string;
        };
        Update: {
          commit_sha?: string | null;
          created_at?: string;
          dataset?: string | null;
          id?: string;
          metrics?: Json | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      memories: {
        Row: {
          content: string;
          created_at: string;
          embedding: string | null;
          id: string;
          kind: string | null;
          salience: number | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          embedding?: string | null;
          id?: string;
          kind?: string | null;
          salience?: number | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          embedding?: string | null;
          id?: string;
          kind?: string | null;
          salience?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          citations: Json | null;
          content: string | null;
          conversation_id: string;
          cost_usd: number | null;
          created_at: string;
          id: string;
          latency_ms: number | null;
          role: string;
          tokens_in: number | null;
          tokens_out: number | null;
          tool_calls: Json | null;
          updated_at: string;
        };
        Insert: {
          citations?: Json | null;
          content?: string | null;
          conversation_id: string;
          cost_usd?: number | null;
          created_at?: string;
          id?: string;
          latency_ms?: number | null;
          role: string;
          tokens_in?: number | null;
          tokens_out?: number | null;
          tool_calls?: Json | null;
          updated_at?: string;
        };
        Update: {
          citations?: Json | null;
          content?: string | null;
          conversation_id?: string;
          cost_usd?: number | null;
          created_at?: string;
          id?: string;
          latency_ms?: number | null;
          role?: string;
          tokens_in?: number | null;
          tokens_out?: number | null;
          tool_calls?: Json | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      nutrition_logs: {
        Row: {
          created_at: string;
          date: string;
          id: string;
          notes: string | null;
          payload: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          date?: string;
          id?: string;
          notes?: string | null;
          payload?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          date?: string;
          id?: string;
          notes?: string | null;
          payload?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          activity_level: string | null;
          age: number | null;
          created_at: string;
          display_name: string | null;
          goals: string | null;
          height_cm: number | null;
          id: string;
          preferences: Json;
          sex: string | null;
          units: string | null;
          updated_at: string;
          weight_kg: number | null;
        };
        Insert: {
          activity_level?: string | null;
          age?: number | null;
          created_at?: string;
          display_name?: string | null;
          goals?: string | null;
          height_cm?: number | null;
          id: string;
          preferences?: Json;
          sex?: string | null;
          units?: string | null;
          updated_at?: string;
          weight_kg?: number | null;
        };
        Update: {
          activity_level?: string | null;
          age?: number | null;
          created_at?: string;
          display_name?: string | null;
          goals?: string | null;
          height_cm?: number | null;
          id?: string;
          preferences?: Json;
          sex?: string | null;
          units?: string | null;
          updated_at?: string;
          weight_kg?: number | null;
        };
        Relationships: [];
      };
      traces: {
        Row: {
          cost_usd: number | null;
          created_at: string;
          id: string;
          latency_ms: number | null;
          payload: Json | null;
          request_id: string | null;
          stage: string | null;
          tokens: number | null;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          cost_usd?: number | null;
          created_at?: string;
          id?: string;
          latency_ms?: number | null;
          payload?: Json | null;
          request_id?: string | null;
          stage?: string | null;
          tokens?: number | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          cost_usd?: number | null;
          created_at?: string;
          id?: string;
          latency_ms?: number | null;
          payload?: Json | null;
          request_id?: string | null;
          stage?: string | null;
          tokens?: number | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      workouts: {
        Row: {
          created_at: string;
          date: string;
          id: string;
          notes: string | null;
          payload: Json;
          type: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          date?: string;
          id?: string;
          notes?: string | null;
          payload?: Json;
          type?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          date?: string;
          id?: string;
          notes?: string | null;
          payload?: Json;
          type?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      match_chunks: {
        Args: { filter?: Json; match_count?: number; query_embedding: string };
        Returns: {
          content: string;
          document_id: string;
          heading: string;
          id: string;
          metadata: Json;
          similarity: number;
          source_url: string;
        }[];
      };
      match_memories: {
        Args: { match_count?: number; query_embedding: string };
        Returns: {
          content: string;
          id: string;
          kind: string;
          salience: number;
          similarity: number;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
