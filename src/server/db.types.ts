
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "activities": {
                  Row: {
                    "course_id": string,"created_at": string,"cycle_id": string,"est_minutes": number | null,"id": string,"instructions": NonNullable<Json>,"phase": Database["public"]['Enums']["learning_phase"],"scoring_mode": Database["public"]['Enums']["scoring_mode"],"slug": string,"status": Database["public"]['Enums']["content_status"],"title": string,"updated_at": string
                  }
                  Insert: {
                    "course_id": string,"created_at"?: string,"cycle_id": string,"est_minutes"?: number | null,"id"?: string,"instructions"?: NonNullable<Json>,"phase"?: Database["public"]['Enums']["learning_phase"],"scoring_mode"?: Database["public"]['Enums']["scoring_mode"],"slug": string,"status"?: Database["public"]['Enums']["content_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "course_id"?: string,"created_at"?: string,"cycle_id"?: string,"est_minutes"?: number | null,"id"?: string,"instructions"?: NonNullable<Json>,"phase"?: Database["public"]['Enums']["learning_phase"],"scoring_mode"?: Database["public"]['Enums']["scoring_mode"],"slug"?: string,"status"?: Database["public"]['Enums']["content_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activities_cycle_id_course_id_fkey"
      columns: ["cycle_id","course_id"]
isOneToOne: false
      referencedRelation: "cycles"
      referencedColumns: ["id","course_id"]
    }
                  ]
                },"activity_item_keys": {
                  Row: {
                    "answer": NonNullable<Json>,"course_id": string,"feedback": NonNullable<Json>,"item_id": string
                  }
                  Insert: {
                    "answer": NonNullable<Json>,"course_id": string,"feedback"?: NonNullable<Json>,"item_id": string
                  }
                  Update: {
                    "answer"?: NonNullable<Json>,"course_id"?: string,"feedback"?: NonNullable<Json>,"item_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_item_keys_item_id_course_id_fkey"
      columns: ["item_id","course_id"]
isOneToOne: false
      referencedRelation: "activity_items"
      referencedColumns: ["id","course_id"]
    }
                  ]
                },"activity_items": {
                  Row: {
                    "activity_id": string,"course_id": string,"created_at": string,"data": NonNullable<Json>,"id": string,"points": number,"position": number,"prompt": NonNullable<Json>,"type": string
                  }
                  Insert: {
                    "activity_id": string,"course_id": string,"created_at"?: string,"data"?: NonNullable<Json>,"id"?: string,"points"?: number,"position"?: number,"prompt"?: NonNullable<Json>,"type": string
                  }
                  Update: {
                    "activity_id"?: string,"course_id"?: string,"created_at"?: string,"data"?: NonNullable<Json>,"id"?: string,"points"?: number,"position"?: number,"prompt"?: NonNullable<Json>,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_items_activity_id_course_id_fkey"
      columns: ["activity_id","course_id"]
isOneToOne: false
      referencedRelation: "activities"
      referencedColumns: ["id","course_id"]
    }
                  ]
                },"activity_skills": {
                  Row: {
                    "activity_id": string,"skill_id": string
                  }
                  Insert: {
                    "activity_id": string,"skill_id": string
                  }
                  Update: {
                    "activity_id"?: string,"skill_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_skills_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: false
      referencedRelation: "activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_skills_skill_id_fkey"
      columns: ["skill_id"]
isOneToOne: false
      referencedRelation: "skills"
      referencedColumns: ["id"]
    }
                  ]
                },"assignment_recipients": {
                  Row: {
                    "assignment_id": string,"student_id": string
                  }
                  Insert: {
                    "assignment_id": string,"student_id": string
                  }
                  Update: {
                    "assignment_id"?: string,"student_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "assignment_recipients_assignment_id_fkey"
      columns: ["assignment_id"]
isOneToOne: false
      referencedRelation: "assignments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignment_recipients_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"assignments": {
                  Row: {
                    "activity_id": string | null,"assigned_by": string | null,"audience": Database["public"]['Enums']["assignment_audience"],"available_from": string,"book_section_id": string | null,"course_id": string,"created_at": string,"due_at": string | null,"group_id": string,"id": string,"note": string,"phase": Database["public"]['Enums']["learning_phase"],"vocabulary_set_id": string | null
                  }
                  Insert: {
                    "activity_id"?: string | null,"assigned_by"?: string | null,"audience"?: Database["public"]['Enums']["assignment_audience"],"available_from"?: string,"book_section_id"?: string | null,"course_id": string,"created_at"?: string,"due_at"?: string | null,"group_id": string,"id"?: string,"note"?: string,"phase"?: Database["public"]['Enums']["learning_phase"],"vocabulary_set_id"?: string | null
                  }
                  Update: {
                    "activity_id"?: string | null,"assigned_by"?: string | null,"audience"?: Database["public"]['Enums']["assignment_audience"],"available_from"?: string,"book_section_id"?: string | null,"course_id"?: string,"created_at"?: string,"due_at"?: string | null,"group_id"?: string,"id"?: string,"note"?: string,"phase"?: Database["public"]['Enums']["learning_phase"],"vocabulary_set_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "assignments_activity_id_course_id_fkey"
      columns: ["activity_id","course_id"]
isOneToOne: false
      referencedRelation: "activities"
      referencedColumns: ["id","course_id"]
    },{
      foreignKeyName: "assignments_assigned_by_fkey"
      columns: ["assigned_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_book_section_id_course_id_fkey"
      columns: ["book_section_id","course_id"]
isOneToOne: false
      referencedRelation: "book_sections"
      referencedColumns: ["id","course_id"]
    },{
      foreignKeyName: "assignments_group_id_course_id_fkey"
      columns: ["group_id","course_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","course_id"]
    },{
      foreignKeyName: "assignments_vocabulary_set_id_course_id_fkey"
      columns: ["vocabulary_set_id","course_id"]
isOneToOne: false
      referencedRelation: "vocabulary_sets"
      referencedColumns: ["id","course_id"]
    }
                  ]
                },"attempts": {
                  Row: {
                    "activity_id": string,"assignment_id": string | null,"attempt_no": number,"course_id": string,"id": string,"max_score": number | null,"score": number | null,"started_at": string,"state": NonNullable<Json>,"status": Database["public"]['Enums']["attempt_status"],"submitted_at": string | null,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "activity_id": string,"assignment_id"?: string | null,"attempt_no"?: number,"course_id": string,"id"?: string,"max_score"?: number | null,"score"?: number | null,"started_at"?: string,"state"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["attempt_status"],"submitted_at"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "activity_id"?: string,"assignment_id"?: string | null,"attempt_no"?: number,"course_id"?: string,"id"?: string,"max_score"?: number | null,"score"?: number | null,"started_at"?: string,"state"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["attempt_status"],"submitted_at"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attempts_activity_id_course_id_fkey"
      columns: ["activity_id","course_id"]
isOneToOne: false
      referencedRelation: "activities"
      referencedColumns: ["id","course_id"]
    },{
      foreignKeyName: "attempts_assignment_id_fkey"
      columns: ["assignment_id"]
isOneToOne: false
      referencedRelation: "assignments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attempts_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"after": Json | null,"before": Json | null,"entity_id": string | null,"entity_type": string,"id": number,"occurred_at": string
                  }
                  Insert: {
                    "action": string,"actor_id"?: string | null,"after"?: Json | null,"before"?: Json | null,"entity_id"?: string | null,"entity_type": string,"id"?: never,"occurred_at"?: string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"after"?: Json | null,"before"?: Json | null,"entity_id"?: string | null,"entity_type"?: string,"id"?: never,"occurred_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"book_sections": {
                  Row: {
                    "blocks": NonNullable<Json>,"book_id": string,"course_id": string,"created_at": string,"cycle_id": string,"id": string,"phase": Database["public"]['Enums']["learning_phase"] | null,"position": number,"schema_version": number,"status": Database["public"]['Enums']["content_status"],"title": string,"updated_at": string
                  }
                  Insert: {
                    "blocks"?: NonNullable<Json>,"book_id": string,"course_id": string,"created_at"?: string,"cycle_id": string,"id"?: string,"phase"?: Database["public"]['Enums']["learning_phase"] | null,"position"?: number,"schema_version"?: number,"status"?: Database["public"]['Enums']["content_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "blocks"?: NonNullable<Json>,"book_id"?: string,"course_id"?: string,"created_at"?: string,"cycle_id"?: string,"id"?: string,"phase"?: Database["public"]['Enums']["learning_phase"] | null,"position"?: number,"schema_version"?: number,"status"?: Database["public"]['Enums']["content_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "book_sections_book_id_course_id_fkey"
      columns: ["book_id","course_id"]
isOneToOne: false
      referencedRelation: "books"
      referencedColumns: ["id","course_id"]
    },{
      foreignKeyName: "book_sections_cycle_id_course_id_fkey"
      columns: ["cycle_id","course_id"]
isOneToOne: false
      referencedRelation: "cycles"
      referencedColumns: ["id","course_id"]
    }
                  ]
                },"books": {
                  Row: {
                    "course_id": string,"created_at": string,"id": string,"kind": Database["public"]['Enums']["book_kind"],"title": string
                  }
                  Insert: {
                    "course_id": string,"created_at"?: string,"id"?: string,"kind": Database["public"]['Enums']["book_kind"],"title": string
                  }
                  Update: {
                    "course_id"?: string,"created_at"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["book_kind"],"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "books_course_id_fkey"
      columns: ["course_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id"]
    }
                  ]
                },"courses": {
                  Row: {
                    "created_at": string,"description": string,"id": string,"instruction_locale": string,"level_id": string,"published_at": string | null,"slug": string,"status": Database["public"]['Enums']["content_status"],"title": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"description"?: string,"id"?: string,"instruction_locale"?: string,"level_id": string,"published_at"?: string | null,"slug": string,"status"?: Database["public"]['Enums']["content_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string,"id"?: string,"instruction_locale"?: string,"level_id"?: string,"published_at"?: string | null,"slug"?: string,"status"?: Database["public"]['Enums']["content_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "courses_level_id_fkey"
      columns: ["level_id"]
isOneToOne: false
      referencedRelation: "levels"
      referencedColumns: ["id"]
    }
                  ]
                },"cycles": {
                  Row: {
                    "communicative_goal": string,"course_id": string,"created_at": string,"id": string,"position": number,"slug": string,"status": Database["public"]['Enums']["content_status"],"title": string,"updated_at": string
                  }
                  Insert: {
                    "communicative_goal"?: string,"course_id": string,"created_at"?: string,"id"?: string,"position"?: number,"slug": string,"status"?: Database["public"]['Enums']["content_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "communicative_goal"?: string,"course_id"?: string,"created_at"?: string,"id"?: string,"position"?: number,"slug"?: string,"status"?: Database["public"]['Enums']["content_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "cycles_course_id_fkey"
      columns: ["course_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id"]
    }
                  ]
                },"enrollments": {
                  Row: {
                    "created_at": string,"ended_on": string | null,"group_id": string,"id": string,"started_on": string,"status": Database["public"]['Enums']["enrollment_status"],"student_id": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"ended_on"?: string | null,"group_id": string,"id"?: string,"started_on"?: string,"status"?: Database["public"]['Enums']["enrollment_status"],"student_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"ended_on"?: string | null,"group_id"?: string,"id"?: string,"started_on"?: string,"status"?: Database["public"]['Enums']["enrollment_status"],"student_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "enrollments_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "enrollments_student_id_fkey"
      columns: ["student_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"group_cycles": {
                  Row: {
                    "activated_at": string | null,"course_id": string,"cycle_id": string,"group_id": string,"position": number,"state": Database["public"]['Enums']["group_cycle_state"]
                  }
                  Insert: {
                    "activated_at"?: string | null,"course_id": string,"cycle_id": string,"group_id": string,"position"?: number,"state"?: Database["public"]['Enums']["group_cycle_state"]
                  }
                  Update: {
                    "activated_at"?: string | null,"course_id"?: string,"cycle_id"?: string,"group_id"?: string,"position"?: number,"state"?: Database["public"]['Enums']["group_cycle_state"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_cycles_cycle_id_course_id_fkey"
      columns: ["cycle_id","course_id"]
isOneToOne: false
      referencedRelation: "cycles"
      referencedColumns: ["id","course_id"]
    },{
      foreignKeyName: "group_cycles_group_id_course_id_fkey"
      columns: ["group_id","course_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","course_id"]
    }
                  ]
                },"group_sessions": {
                  Row: {
                    "created_at": string,"cycle_id": string | null,"group_id": string,"id": string,"starts_at": string
                  }
                  Insert: {
                    "created_at"?: string,"cycle_id"?: string | null,"group_id": string,"id"?: string,"starts_at": string
                  }
                  Update: {
                    "created_at"?: string,"cycle_id"?: string | null,"group_id"?: string,"id"?: string,"starts_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_sessions_cycle_id_fkey"
      columns: ["cycle_id"]
isOneToOne: false
      referencedRelation: "cycles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "group_sessions_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    }
                  ]
                },"group_teachers": {
                  Row: {
                    "created_at": string,"group_id": string,"role": Database["public"]['Enums']["teacher_role"],"teacher_id": string
                  }
                  Insert: {
                    "created_at"?: string,"group_id": string,"role"?: Database["public"]['Enums']["teacher_role"],"teacher_id": string
                  }
                  Update: {
                    "created_at"?: string,"group_id"?: string,"role"?: Database["public"]['Enums']["teacher_role"],"teacher_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_teachers_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "group_teachers_teacher_id_fkey"
      columns: ["teacher_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"groups": {
                  Row: {
                    "course_id": string,"created_at": string,"ends_on": string | null,"id": string,"name": string,"schedule_note": string,"starts_on": string | null,"status": Database["public"]['Enums']["group_status"],"updated_at": string
                  }
                  Insert: {
                    "course_id": string,"created_at"?: string,"ends_on"?: string | null,"id"?: string,"name": string,"schedule_note"?: string,"starts_on"?: string | null,"status"?: Database["public"]['Enums']["group_status"],"updated_at"?: string
                  }
                  Update: {
                    "course_id"?: string,"created_at"?: string,"ends_on"?: string | null,"id"?: string,"name"?: string,"schedule_note"?: string,"starts_on"?: string | null,"status"?: Database["public"]['Enums']["group_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "groups_course_id_fkey"
      columns: ["course_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id"]
    }
                  ]
                },"languages": {
                  Row: {
                    "code": string,"created_at": string,"direction": Database["public"]['Enums']["text_direction"],"id": string,"name": string
                  }
                  Insert: {
                    "code": string,"created_at"?: string,"direction"?: Database["public"]['Enums']["text_direction"],"id"?: string,"name": string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"direction"?: Database["public"]['Enums']["text_direction"],"id"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"learning_events": {
                  Row: {
                    "activity_id": string | null,"course_id": string | null,"cycle_id": string | null,"id": number,"occurred_at": string,"payload": NonNullable<Json>,"section_id": string | null,"type": Database["public"]['Enums']["learning_event_type"],"user_id": string
                  }
                  Insert: {
                    "activity_id"?: string | null,"course_id"?: string | null,"cycle_id"?: string | null,"id"?: never,"occurred_at"?: string,"payload"?: NonNullable<Json>,"section_id"?: string | null,"type": Database["public"]['Enums']["learning_event_type"],"user_id": string
                  }
                  Update: {
                    "activity_id"?: string | null,"course_id"?: string | null,"cycle_id"?: string | null,"id"?: never,"occurred_at"?: string,"payload"?: NonNullable<Json>,"section_id"?: string | null,"type"?: Database["public"]['Enums']["learning_event_type"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "learning_events_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: false
      referencedRelation: "activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "learning_events_course_id_fkey"
      columns: ["course_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "learning_events_cycle_id_fkey"
      columns: ["cycle_id"]
isOneToOne: false
      referencedRelation: "cycles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "learning_events_section_id_fkey"
      columns: ["section_id"]
isOneToOne: false
      referencedRelation: "book_sections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "learning_events_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"levels": {
                  Row: {
                    "cefr": string | null,"code": string,"created_at": string,"id": string,"language_id": string,"position": number,"title": string
                  }
                  Insert: {
                    "cefr"?: string | null,"code": string,"created_at"?: string,"id"?: string,"language_id": string,"position"?: number,"title": string
                  }
                  Update: {
                    "cefr"?: string | null,"code"?: string,"created_at"?: string,"id"?: string,"language_id"?: string,"position"?: number,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "levels_language_id_fkey"
      columns: ["language_id"]
isOneToOne: false
      referencedRelation: "languages"
      referencedColumns: ["id"]
    }
                  ]
                },"media_assets": {
                  Row: {
                    "alt_text": string,"bucket": string,"bytes": number | null,"course_id": string | null,"created_at": string,"created_by": string | null,"duration_s": number | null,"id": string,"kind": string,"mime": string,"path": string,"source": string,"transcript": string
                  }
                  Insert: {
                    "alt_text"?: string,"bucket": string,"bytes"?: number | null,"course_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"duration_s"?: number | null,"id"?: string,"kind": string,"mime": string,"path": string,"source"?: string,"transcript"?: string
                  }
                  Update: {
                    "alt_text"?: string,"bucket"?: string,"bytes"?: number | null,"course_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"duration_s"?: number | null,"id"?: string,"kind"?: string,"mime"?: string,"path"?: string,"source"?: string,"transcript"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "media_assets_course_id_fkey"
      columns: ["course_id"]
isOneToOne: false
      referencedRelation: "courses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "media_assets_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_path": string | null,"created_at": string,"display_name": string,"id": string,"timezone": string,"ui_locale": string,"updated_at": string
                  }
                  Insert: {
                    "avatar_path"?: string | null,"created_at"?: string,"display_name": string,"id": string,"timezone"?: string,"ui_locale"?: string,"updated_at"?: string
                  }
                  Update: {
                    "avatar_path"?: string | null,"created_at"?: string,"display_name"?: string,"id"?: string,"timezone"?: string,"ui_locale"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"recommendation_feedback": {
                  Row: {
                    "action": string,"at": string,"rec_key": string,"user_id": string
                  }
                  Insert: {
                    "action": string,"at"?: string,"rec_key": string,"user_id": string
                  }
                  Update: {
                    "action"?: string,"at"?: string,"rec_key"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "recommendation_feedback_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"responses": {
                  Row: {
                    "answer": NonNullable<Json>,"attempt_id": string,"course_id": string,"created_at": string,"feedback_code": string | null,"id": string,"is_correct": boolean | null,"item_id": string,"score": number | null,"try_no": number,"user_id": string
                  }
                  Insert: {
                    "answer": NonNullable<Json>,"attempt_id": string,"course_id": string,"created_at"?: string,"feedback_code"?: string | null,"id"?: string,"is_correct"?: boolean | null,"item_id": string,"score"?: number | null,"try_no"?: number,"user_id": string
                  }
                  Update: {
                    "answer"?: NonNullable<Json>,"attempt_id"?: string,"course_id"?: string,"created_at"?: string,"feedback_code"?: string | null,"id"?: string,"is_correct"?: boolean | null,"item_id"?: string,"score"?: number | null,"try_no"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "responses_attempt_id_user_id_course_id_fkey"
      columns: ["attempt_id","user_id","course_id"]
isOneToOne: false
      referencedRelation: "attempts"
      referencedColumns: ["id","user_id","course_id"]
    },{
      foreignKeyName: "responses_item_id_course_id_fkey"
      columns: ["item_id","course_id"]
isOneToOne: false
      referencedRelation: "activity_items"
      referencedColumns: ["id","course_id"]
    }
                  ]
                },"section_progress": {
                  Row: {
                    "book_section_id": string,"completed_at": string | null,"course_id": string,"last_block_id": string | null,"status": Database["public"]['Enums']["progress_status"],"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "book_section_id": string,"completed_at"?: string | null,"course_id": string,"last_block_id"?: string | null,"status"?: Database["public"]['Enums']["progress_status"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "book_section_id"?: string,"completed_at"?: string | null,"course_id"?: string,"last_block_id"?: string | null,"status"?: Database["public"]['Enums']["progress_status"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "section_progress_book_section_id_course_id_fkey"
      columns: ["book_section_id","course_id"]
isOneToOne: false
      referencedRelation: "book_sections"
      referencedColumns: ["id","course_id"]
    },{
      foreignKeyName: "section_progress_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"section_teacher_notes": {
                  Row: {
                    "blocks": NonNullable<Json>,"course_id": string,"section_id": string,"updated_at": string
                  }
                  Insert: {
                    "blocks"?: NonNullable<Json>,"course_id": string,"section_id": string,"updated_at"?: string
                  }
                  Update: {
                    "blocks"?: NonNullable<Json>,"course_id"?: string,"section_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "section_teacher_notes_section_id_course_id_fkey"
      columns: ["section_id","course_id"]
isOneToOne: false
      referencedRelation: "book_sections"
      referencedColumns: ["id","course_id"]
    }
                  ]
                },"skills": {
                  Row: {
                    "code": string,"id": string,"label": string
                  }
                  Insert: {
                    "code": string,"id"?: string,"label": string
                  }
                  Update: {
                    "code"?: string,"id"?: string,"label"?: string
                  }
                  Relationships: [
                    
                  ]
                },"user_roles": {
                  Row: {
                    "granted_at": string,"granted_by": string | null,"role": Database["public"]['Enums']["app_role"],"user_id": string
                  }
                  Insert: {
                    "granted_at"?: string,"granted_by"?: string | null,"role": Database["public"]['Enums']["app_role"],"user_id": string
                  }
                  Update: {
                    "granted_at"?: string,"granted_by"?: string | null,"role"?: Database["public"]['Enums']["app_role"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_roles_granted_by_fkey"
      columns: ["granted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "user_roles_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"vocab_review_state": {
                  Row: {
                    "box": number,"correct_streak": number,"course_id": string,"due_at": string,"lapses": number,"last_reviewed_at": string | null,"user_id": string,"vocabulary_item_id": string
                  }
                  Insert: {
                    "box"?: number,"correct_streak"?: number,"course_id": string,"due_at"?: string,"lapses"?: number,"last_reviewed_at"?: string | null,"user_id": string,"vocabulary_item_id": string
                  }
                  Update: {
                    "box"?: number,"correct_streak"?: number,"course_id"?: string,"due_at"?: string,"lapses"?: number,"last_reviewed_at"?: string | null,"user_id"?: string,"vocabulary_item_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "vocab_review_state_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vocab_review_state_vocabulary_item_id_course_id_fkey"
      columns: ["vocabulary_item_id","course_id"]
isOneToOne: false
      referencedRelation: "vocabulary_items"
      referencedColumns: ["id","course_id"]
    }
                  ]
                },"vocabulary_items": {
                  Row: {
                    "attrs": NonNullable<Json>,"audio_asset_id": string | null,"course_id": string,"example": string,"gloss": string,"id": string,"image_asset_id": string | null,"notes": string,"position": number,"set_id": string,"term": string
                  }
                  Insert: {
                    "attrs"?: NonNullable<Json>,"audio_asset_id"?: string | null,"course_id": string,"example"?: string,"gloss"?: string,"id"?: string,"image_asset_id"?: string | null,"notes"?: string,"position"?: number,"set_id": string,"term": string
                  }
                  Update: {
                    "attrs"?: NonNullable<Json>,"audio_asset_id"?: string | null,"course_id"?: string,"example"?: string,"gloss"?: string,"id"?: string,"image_asset_id"?: string | null,"notes"?: string,"position"?: number,"set_id"?: string,"term"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "vocabulary_items_audio_asset_id_fkey"
      columns: ["audio_asset_id"]
isOneToOne: false
      referencedRelation: "media_assets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vocabulary_items_image_asset_id_fkey"
      columns: ["image_asset_id"]
isOneToOne: false
      referencedRelation: "media_assets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vocabulary_items_set_id_course_id_fkey"
      columns: ["set_id","course_id"]
isOneToOne: false
      referencedRelation: "vocabulary_sets"
      referencedColumns: ["id","course_id"]
    }
                  ]
                },"vocabulary_sets": {
                  Row: {
                    "course_id": string,"created_at": string,"cycle_id": string,"id": string,"status": Database["public"]['Enums']["content_status"],"title": string
                  }
                  Insert: {
                    "course_id": string,"created_at"?: string,"cycle_id": string,"id"?: string,"status"?: Database["public"]['Enums']["content_status"],"title": string
                  }
                  Update: {
                    "course_id"?: string,"created_at"?: string,"cycle_id"?: string,"id"?: string,"status"?: Database["public"]['Enums']["content_status"],"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "vocabulary_sets_cycle_id_course_id_fkey"
      columns: ["cycle_id","course_id"]
isOneToOne: false
      referencedRelation: "cycles"
      referencedColumns: ["id","course_id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            "app_role": "student"|"teacher"|"pedagogical_manager"|"admin","assignment_audience": "group"|"selected","attempt_status": "in_progress"|"submitted","book_kind": "notebook"|"workbook","content_status": "draft"|"in_review"|"published"|"archived","enrollment_status": "active"|"paused"|"completed"|"withdrawn","group_cycle_state": "upcoming"|"active"|"completed","group_status": "planned"|"active"|"finished"|"archived","learning_event_type": "login"|"activity_started"|"activity_completed"|"answer_submitted"|"section_opened"|"section_completed"|"vocab_reviewed"|"assignment_completed","learning_phase": "before_class"|"during_class"|"after_class"|"review"|"optional","progress_status": "not_started"|"in_progress"|"completed","scoring_mode": "none"|"practice"|"scored","teacher_role": "lead"|"assistant","text_direction": "ltr"|"rtl"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "app_role": ["student", "teacher", "pedagogical_manager", "admin"],"assignment_audience": ["group", "selected"],"attempt_status": ["in_progress", "submitted"],"book_kind": ["notebook", "workbook"],"content_status": ["draft", "in_review", "published", "archived"],"enrollment_status": ["active", "paused", "completed", "withdrawn"],"group_cycle_state": ["upcoming", "active", "completed"],"group_status": ["planned", "active", "finished", "archived"],"learning_event_type": ["login", "activity_started", "activity_completed", "answer_submitted", "section_opened", "section_completed", "vocab_reviewed", "assignment_completed"],"learning_phase": ["before_class", "during_class", "after_class", "review", "optional"],"progress_status": ["not_started", "in_progress", "completed"],"scoring_mode": ["none", "practice", "scored"],"teacher_role": ["lead", "assistant"],"text_direction": ["ltr", "rtl"]
          }
        }
} as const
