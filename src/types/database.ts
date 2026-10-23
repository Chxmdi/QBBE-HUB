
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
            "access_grant": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"legacy_id": string | null,"object_id": string,"org_role": Database["public"]['Enums']["org_role"] | null,"organization_id": string,"principal_kind": string,"reach": string,"role_id": string,"source": string,"team_id": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"legacy_id"?: string | null,"object_id": string,"org_role"?: Database["public"]['Enums']["org_role"] | null,"organization_id": string,"principal_kind": string,"reach"?: string,"role_id": string,"source"?: string,"team_id"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"legacy_id"?: string | null,"object_id"?: string,"org_role"?: Database["public"]['Enums']["org_role"] | null,"organization_id"?: string,"principal_kind"?: string,"reach"?: string,"role_id"?: string,"source"?: string,"team_id"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "access_grant_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "access_grant_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "access_grant_role_id_fkey"
      columns: ["role_id"]
isOneToOne: false
      referencedRelation: "access_role"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "access_grant_team_org_fk"
      columns: ["team_id","organization_id"]
isOneToOne: false
      referencedRelation: "team"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "access_grant_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"access_role": {
                  Row: {
                    "builtin": boolean,"caps": number,"created_at": string,"created_by": string | null,"id": string,"key": string,"name_en": string,"name_fr": string,"organization_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "builtin"?: boolean,"caps": number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"key": string,"name_en": string,"name_fr": string,"organization_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "builtin"?: boolean,"caps"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"key"?: string,"name_en"?: string,"name_fr"?: string,"organization_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "access_role_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "access_role_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"activity_entry": {
                  Row: {
                    "actor_id": string | null,"actor_kind": string,"details": NonNullable<Json>,"event": string,"id": string,"object_id": string,"object_type": string,"occurred_at": string,"organization_id": string,"seq": number,"source_event_id": string | null,"subject": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"actor_kind": string,"details"?: NonNullable<Json>,"event": string,"id"?: string,"object_id": string,"object_type": string,"occurred_at"?: string,"organization_id": string,"seq"?: never,"source_event_id"?: string | null,"subject"?: string | null
                  }
                  Update: {
                    "actor_id"?: string | null,"actor_kind"?: string,"details"?: NonNullable<Json>,"event"?: string,"id"?: string,"object_id"?: string,"object_type"?: string,"occurred_at"?: string,"organization_id"?: string,"seq"?: never,"source_event_id"?: string | null,"subject"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_entry_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"activity_event": {
                  Row: {
                    "actor_id": string | null,"created_at": string,"id": string,"metadata": NonNullable<Json>,"organization_id": string,"program_id": string | null,"project_id": string | null,"source_id": string,"source_type": string,"summary": string,"verb": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"created_at"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"organization_id": string,"program_id"?: string | null,"project_id"?: string | null,"source_id": string,"source_type": string,"summary": string,"verb": string
                  }
                  Update: {
                    "actor_id"?: string | null,"created_at"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"organization_id"?: string,"program_id"?: string | null,"project_id"?: string | null,"source_id"?: string,"source_type"?: string,"summary"?: string,"verb"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_event_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_event_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_event_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_event_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    }
                  ]
                },"agenda_item": {
                  Row: {
                    "carried_from_id": string | null,"combined_into_id": string | null,"created_at": string,"desired_outcome": string | null,"id": string,"kind": Database["public"]['Enums']["agenda_kind"],"linked_contact_id": string | null,"linked_decision_id": string | null,"linked_event_id": string | null,"linked_issue_id": string | null,"linked_milestone_id": string | null,"linked_risk_id": string | null,"linked_task_id": string | null,"meeting_id": string,"owner_id": string | null,"proposed_by": string | null,"sort_key": number,"source_message_id": string | null,"status": string,"time_box_minutes": number | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "carried_from_id"?: string | null,"combined_into_id"?: string | null,"created_at"?: string,"desired_outcome"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["agenda_kind"],"linked_contact_id"?: string | null,"linked_decision_id"?: string | null,"linked_event_id"?: string | null,"linked_issue_id"?: string | null,"linked_milestone_id"?: string | null,"linked_risk_id"?: string | null,"linked_task_id"?: string | null,"meeting_id": string,"owner_id"?: string | null,"proposed_by"?: string | null,"sort_key"?: number,"source_message_id"?: string | null,"status"?: string,"time_box_minutes"?: number | null,"title": string
                  }
                  Update: {
                    "carried_from_id"?: string | null,"combined_into_id"?: string | null,"created_at"?: string,"desired_outcome"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["agenda_kind"],"linked_contact_id"?: string | null,"linked_decision_id"?: string | null,"linked_event_id"?: string | null,"linked_issue_id"?: string | null,"linked_milestone_id"?: string | null,"linked_risk_id"?: string | null,"linked_task_id"?: string | null,"meeting_id"?: string,"owner_id"?: string | null,"proposed_by"?: string | null,"sort_key"?: number,"source_message_id"?: string | null,"status"?: string,"time_box_minutes"?: number | null,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agenda_item_carried_from_id_fkey"
      columns: ["carried_from_id"]
isOneToOne: false
      referencedRelation: "agenda_item"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agenda_item_combined_into_id_fkey"
      columns: ["combined_into_id"]
isOneToOne: false
      referencedRelation: "agenda_item"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agenda_item_linked_contact_id_fkey"
      columns: ["linked_contact_id"]
isOneToOne: false
      referencedRelation: "crm_contact"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agenda_item_linked_decision_id_fkey"
      columns: ["linked_decision_id"]
isOneToOne: false
      referencedRelation: "decision"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agenda_item_linked_event_id_fkey"
      columns: ["linked_event_id"]
isOneToOne: false
      referencedRelation: "event"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agenda_item_linked_milestone_id_fkey"
      columns: ["linked_milestone_id"]
isOneToOne: false
      referencedRelation: "milestone"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agenda_item_linked_task_id_fkey"
      columns: ["linked_task_id"]
isOneToOne: false
      referencedRelation: "task"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agenda_item_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meeting"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agenda_item_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agenda_item_proposed_by_fkey"
      columns: ["proposed_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agenda_item_source_message_id_fkey"
      columns: ["source_message_id"]
isOneToOne: false
      referencedRelation: "message"
      referencedColumns: ["id"]
    }
                  ]
                },"agenda_template": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"created_at": string,"created_by": string | null,"id": string,"items": NonNullable<Json>,"kind": string,"name": string,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"items"?: NonNullable<Json>,"kind": string,"name": string,"organization_id": string
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"items"?: NonNullable<Json>,"kind"?: string,"name"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agenda_template_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agenda_template_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agenda_template_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"announcement": {
                  Row: {
                    "ack_deadline": string | null,"body": string | null,"channel_id": string | null,"created_at": string,"created_by": string,"expires_at": string | null,"fanned_out_at": string | null,"id": string,"message_id": string | null,"organization_id": string,"pinned_until": string | null,"priority": Database["public"]['Enums']["announcement_priority"],"publish_at": string,"requires_ack": boolean,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ack_deadline"?: string | null,"body"?: string | null,"channel_id"?: string | null,"created_at"?: string,"created_by": string,"expires_at"?: string | null,"fanned_out_at"?: string | null,"id"?: string,"message_id"?: string | null,"organization_id": string,"pinned_until"?: string | null,"priority"?: Database["public"]['Enums']["announcement_priority"],"publish_at"?: string,"requires_ack"?: boolean,"title": string
                  }
                  Update: {
                    "ack_deadline"?: string | null,"body"?: string | null,"channel_id"?: string | null,"created_at"?: string,"created_by"?: string,"expires_at"?: string | null,"fanned_out_at"?: string | null,"id"?: string,"message_id"?: string | null,"organization_id"?: string,"pinned_until"?: string | null,"priority"?: Database["public"]['Enums']["announcement_priority"],"publish_at"?: string,"requires_ack"?: boolean,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "announcement_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "channel"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "announcement_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "announcement_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "message"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "announcement_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"announcement_acknowledgment": {
                  Row: {
                    "acknowledged_at": string,"announcement_id": string,"method": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "acknowledged_at"?: string,"announcement_id": string,"method"?: string,"user_id": string
                  }
                  Update: {
                    "acknowledged_at"?: string,"announcement_id"?: string,"method"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "announcement_acknowledgment_announcement_id_fkey"
      columns: ["announcement_id"]
isOneToOne: false
      referencedRelation: "announcement"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "announcement_acknowledgment_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"api_request_log": {
                  Row: {
                    "created_at": string,"duration_ms": number | null,"error_code": string | null,"id": string,"method": string,"organization_id": string | null,"path": string,"status": number,"token_id": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"duration_ms"?: number | null,"error_code"?: string | null,"id"?: string,"method": string,"organization_id"?: string | null,"path": string,"status": number,"token_id"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"duration_ms"?: number | null,"error_code"?: string | null,"id"?: string,"method"?: string,"organization_id"?: string | null,"path"?: string,"status"?: number,"token_id"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "api_request_log_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "api_request_log_token_id_fkey"
      columns: ["token_id"]
isOneToOne: false
      referencedRelation: "api_token"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "api_request_log_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"api_token": {
                  Row: {
                    "created_at": string,"expires_at": string,"id": string,"last_used_at": string | null,"name": string,"organization_id": string,"revoked_at": string | null,"revoked_by": string | null,"scopes": (string)[],"token_hash": string,"token_prefix": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expires_at": string,"id"?: string,"last_used_at"?: string | null,"name": string,"organization_id": string,"revoked_at"?: string | null,"revoked_by"?: string | null,"scopes": (string)[],"token_hash": string,"token_prefix": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string,"id"?: string,"last_used_at"?: string | null,"name"?: string,"organization_id"?: string,"revoked_at"?: string | null,"revoked_by"?: string | null,"scopes"?: (string)[],"token_hash"?: string,"token_prefix"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "api_token_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "api_token_revoked_by_fkey"
      columns: ["revoked_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "api_token_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"approval_delegation": {
                  Row: {
                    "approver_id": string,"created_at": string,"created_by": string | null,"delegate_id": string,"ended_at": string | null,"ended_by": string | null,"ends_at": string,"ends_on": string,"id": string,"note": string | null,"organization_id": string,"starts_at": string,"starts_on": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approver_id": string,"created_at"?: string,"created_by"?: string | null,"delegate_id": string,"ended_at"?: string | null,"ended_by"?: string | null,"ends_at": string,"ends_on": string,"id"?: string,"note"?: string | null,"organization_id": string,"starts_at": string,"starts_on": string
                  }
                  Update: {
                    "approver_id"?: string,"created_at"?: string,"created_by"?: string | null,"delegate_id"?: string,"ended_at"?: string | null,"ended_by"?: string | null,"ends_at"?: string,"ends_on"?: string,"id"?: string,"note"?: string | null,"organization_id"?: string,"starts_at"?: string,"starts_on"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "approval_delegation_approver_id_fkey"
      columns: ["approver_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_delegation_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_delegation_delegate_id_fkey"
      columns: ["delegate_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_delegation_ended_by_fkey"
      columns: ["ended_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_delegation_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"approval_event": {
                  Row: {
                    "actor_id": string | null,"created_at": string,"id": string,"item_id": string,"kind": string,"note": string | null,"on_behalf_of": string | null,"organization_id": string,"step": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"created_at"?: string,"id"?: string,"item_id": string,"kind": string,"note"?: string | null,"on_behalf_of"?: string | null,"organization_id": string,"step"?: number | null
                  }
                  Update: {
                    "actor_id"?: string | null,"created_at"?: string,"id"?: string,"item_id"?: string,"kind"?: string,"note"?: string | null,"on_behalf_of"?: string | null,"organization_id"?: string,"step"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "approval_event_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_event_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "approval_item"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_event_on_behalf_of_fkey"
      columns: ["on_behalf_of"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_event_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"approval_item": {
                  Row: {
                    "amount_cents": number | null,"created_at": string,"current_step": number | null,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"description": string | null,"id": string,"organization_id": string,"program_id": string | null,"requested_by": string,"status": string,"subject_id": string | null,"subject_type": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: number | null,"created_at"?: string,"current_step"?: number | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"description"?: string | null,"id"?: string,"organization_id": string,"program_id"?: string | null,"requested_by": string,"status"?: string,"subject_id"?: string | null,"subject_type": string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_cents"?: number | null,"created_at"?: string,"current_step"?: number | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"description"?: string | null,"id"?: string,"organization_id"?: string,"program_id"?: string | null,"requested_by"?: string,"status"?: string,"subject_id"?: string | null,"subject_type"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "approval_item_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_item_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_item_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_item_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"approval_request": {
                  Row: {
                    "approver_id": string,"created_at": string,"decided_at": string | null,"decided_by": string | null,"decision": Database["public"]['Enums']["approval_decision"],"decision_note": string | null,"due_at": string | null,"id": string,"note": string | null,"opportunity_id": string | null,"organization_id": string,"project_request_id": string | null,"report_id": string | null,"requested_by": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approver_id": string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision"?: Database["public"]['Enums']["approval_decision"],"decision_note"?: string | null,"due_at"?: string | null,"id"?: string,"note"?: string | null,"opportunity_id"?: string | null,"organization_id": string,"project_request_id"?: string | null,"report_id"?: string | null,"requested_by": string,"updated_at"?: string
                  }
                  Update: {
                    "approver_id"?: string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision"?: Database["public"]['Enums']["approval_decision"],"decision_note"?: string | null,"due_at"?: string | null,"id"?: string,"note"?: string | null,"opportunity_id"?: string | null,"organization_id"?: string,"project_request_id"?: string | null,"report_id"?: string | null,"requested_by"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "approval_request_approver_id_fkey"
      columns: ["approver_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_request_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_request_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunity"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_request_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_request_project_request_id_fkey"
      columns: ["project_request_id"]
isOneToOne: false
      referencedRelation: "project_request"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_request_report_id_fkey"
      columns: ["report_id"]
isOneToOne: false
      referencedRelation: "report_instance"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_request_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"approval_rule": {
                  Row: {
                    "active": boolean,"approver_kind": string,"approver_user_id": string | null,"created_at": string,"created_by": string | null,"id": string,"label": string,"max_amount_cents": number | null,"min_amount_cents": number,"organization_id": string,"program_id": string | null,"step": number,"subject_type": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"approver_kind": string,"approver_user_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"label": string,"max_amount_cents"?: number | null,"min_amount_cents"?: number,"organization_id": string,"program_id"?: string | null,"step"?: number,"subject_type"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"approver_kind"?: string,"approver_user_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"label"?: string,"max_amount_cents"?: number | null,"min_amount_cents"?: number,"organization_id"?: string,"program_id"?: string | null,"step"?: number,"subject_type"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "approval_rule_approver_user_id_fkey"
      columns: ["approver_user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_rule_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_rule_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_rule_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    }
                  ]
                },"approval_step": {
                  Row: {
                    "approver_id": string | null,"approver_kind": string,"created_at": string,"decided_at": string | null,"decided_by": string | null,"id": string,"item_id": string,"label": string,"note": string | null,"on_behalf_of": string | null,"organization_id": string,"rule_id": string | null,"status": string,"step": number
                  }
                  ComputedFields: never
                  Insert: {
                    "approver_id"?: string | null,"approver_kind": string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"id"?: string,"item_id": string,"label": string,"note"?: string | null,"on_behalf_of"?: string | null,"organization_id": string,"rule_id"?: string | null,"status"?: string,"step": number
                  }
                  Update: {
                    "approver_id"?: string | null,"approver_kind"?: string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"id"?: string,"item_id"?: string,"label"?: string,"note"?: string | null,"on_behalf_of"?: string | null,"organization_id"?: string,"rule_id"?: string | null,"status"?: string,"step"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "approval_step_approver_id_fkey"
      columns: ["approver_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_step_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_step_item_id_fkey"
      columns: ["item_id"]
isOneToOne: false
      referencedRelation: "approval_item"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_step_on_behalf_of_fkey"
      columns: ["on_behalf_of"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_step_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_step_rule_id_fkey"
      columns: ["rule_id"]
isOneToOne: false
      referencedRelation: "approval_rule"
      referencedColumns: ["id"]
    }
                  ]
                },"approved_document_host": {
                  Row: {
                    "created_at": string,"created_by": string | null,"host": string,"id": string,"label": string,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"host": string,"id"?: string,"label"?: string,"organization_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"host"?: string,"id"?: string,"label"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "approved_document_host_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approved_document_host_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_event": {
                  Row: {
                    "action": string,"actor_id": string | null,"actor_type": string,"created_at": string,"event_type": string,"id": string,"metadata": NonNullable<Json>,"object_id": string | null,"object_type": string | null,"organization_id": string | null,"result": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"actor_type"?: string,"created_at"?: string,"event_type": string,"id"?: string,"metadata"?: NonNullable<Json>,"object_id"?: string | null,"object_type"?: string | null,"organization_id"?: string | null,"result"?: string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"actor_type"?: string,"created_at"?: string,"event_type"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"object_id"?: string | null,"object_type"?: string | null,"organization_id"?: string | null,"result"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_event_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"background_job_run": {
                  Row: {
                    "details": NonNullable<Json>,"error": string | null,"finished_at": string,"id": string,"job_name": string,"organization_id": string,"started_at": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "details"?: NonNullable<Json>,"error"?: string | null,"finished_at"?: string,"id"?: string,"job_name": string,"organization_id": string,"started_at"?: string,"status": string
                  }
                  Update: {
                    "details"?: NonNullable<Json>,"error"?: string | null,"finished_at"?: string,"id"?: string,"job_name"?: string,"organization_id"?: string,"started_at"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "background_job_run_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"bank_account": {
                  Row: {
                    "account_last4": string | null,"created_at": string,"created_by": string | null,"default_fund_id": string,"id": string,"institution": string,"is_active": boolean,"ledger_account_id": string,"name": string,"organization_id": string,"reconcile_from": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_last4"?: string | null,"created_at"?: string,"created_by"?: string | null,"default_fund_id": string,"id"?: string,"institution": string,"is_active"?: boolean,"ledger_account_id": string,"name": string,"organization_id": string,"reconcile_from": string,"updated_at"?: string
                  }
                  Update: {
                    "account_last4"?: string | null,"created_at"?: string,"created_by"?: string | null,"default_fund_id"?: string,"id"?: string,"institution"?: string,"is_active"?: boolean,"ledger_account_id"?: string,"name"?: string,"organization_id"?: string,"reconcile_from"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bank_account_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bank_account_organization_id_default_fund_id_fkey"
      columns: ["organization_id","default_fund_id"]
isOneToOne: false
      referencedRelation: "ledger_fund"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "bank_account_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bank_account_organization_id_ledger_account_id_fkey"
      columns: ["organization_id","ledger_account_id"]
isOneToOne: true
      referencedRelation: "ledger_account"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"bank_import": {
                  Row: {
                    "bank_account_id": string,"created_at": string,"file_format": string,"file_name": string,"file_sha256": string,"first_date": string | null,"id": string,"imported_by": string | null,"last_date": string | null,"layout": string,"lines_added": number,"lines_in_file": number,"lines_skipped": number,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bank_account_id": string,"created_at"?: string,"file_format": string,"file_name": string,"file_sha256": string,"first_date"?: string | null,"id"?: string,"imported_by"?: string | null,"last_date"?: string | null,"layout": string,"lines_added"?: number,"lines_in_file": number,"lines_skipped"?: number,"organization_id": string
                  }
                  Update: {
                    "bank_account_id"?: string,"created_at"?: string,"file_format"?: string,"file_name"?: string,"file_sha256"?: string,"first_date"?: string | null,"id"?: string,"imported_by"?: string | null,"last_date"?: string | null,"layout"?: string,"lines_added"?: number,"lines_in_file"?: number,"lines_skipped"?: number,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bank_import_imported_by_fkey"
      columns: ["imported_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bank_import_organization_id_bank_account_id_fkey"
      columns: ["organization_id","bank_account_id"]
isOneToOne: false
      referencedRelation: "bank_account"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"bank_match": {
                  Row: {
                    "bank_transaction_id": string,"journal_line_id": string,"matched_at": string,"matched_by": string | null,"method": string,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bank_transaction_id": string,"journal_line_id": string,"matched_at"?: string,"matched_by"?: string | null,"method": string,"organization_id": string
                  }
                  Update: {
                    "bank_transaction_id"?: string,"journal_line_id"?: string,"matched_at"?: string,"matched_by"?: string | null,"method"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bank_match_journal_line_id_fkey"
      columns: ["journal_line_id"]
isOneToOne: true
      referencedRelation: "journal_line"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bank_match_matched_by_fkey"
      columns: ["matched_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bank_match_organization_id_bank_transaction_id_fkey"
      columns: ["organization_id","bank_transaction_id"]
isOneToOne: false
      referencedRelation: "bank_transaction"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"bank_reconciliation": {
                  Row: {
                    "bank_account_id": string,"closing_balance_cents": number,"created_at": string,"created_by": string | null,"id": string,"opening_balance_cents": number,"organization_id": string,"reconciled_at": string | null,"reconciled_by": string | null,"statement_end": string,"statement_start": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bank_account_id": string,"closing_balance_cents": number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"opening_balance_cents": number,"organization_id": string,"reconciled_at"?: string | null,"reconciled_by"?: string | null,"statement_end": string,"statement_start": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "bank_account_id"?: string,"closing_balance_cents"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"opening_balance_cents"?: number,"organization_id"?: string,"reconciled_at"?: string | null,"reconciled_by"?: string | null,"statement_end"?: string,"statement_start"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bank_reconciliation_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bank_reconciliation_organization_id_bank_account_id_fkey"
      columns: ["organization_id","bank_account_id"]
isOneToOne: false
      referencedRelation: "bank_account"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "bank_reconciliation_reconciled_by_fkey"
      columns: ["reconciled_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"bank_transaction": {
                  Row: {
                    "amount_cents": number,"bank_account_id": string,"created_at": string,"description": string,"fingerprint": string,"id": string,"import_id": string,"organization_id": string,"posted_on": string,"reference": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"bank_account_id": string,"created_at"?: string,"description": string,"fingerprint": string,"id"?: string,"import_id": string,"organization_id": string,"posted_on": string,"reference"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"bank_account_id"?: string,"created_at"?: string,"description"?: string,"fingerprint"?: string,"id"?: string,"import_id"?: string,"organization_id"?: string,"posted_on"?: string,"reference"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "bank_transaction_organization_id_bank_account_id_fkey"
      columns: ["organization_id","bank_account_id"]
isOneToOne: false
      referencedRelation: "bank_account"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "bank_transaction_organization_id_import_id_fkey"
      columns: ["organization_id","import_id"]
isOneToOne: false
      referencedRelation: "bank_import"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"block": {
                  Row: {
                    "block_id": string,"depth": number,"object_id": string,"object_type": string,"organization_id": string,"parent_block_id": string | null,"position": number,"props": NonNullable<Json>,"referenced_kind": string | null,"referenced_object_id": string | null,"search_vector": unknown,"text": string,"type": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "block_id": string,"depth": number,"object_id": string,"object_type": string,"organization_id": string,"parent_block_id"?: string | null,"position": number,"props"?: NonNullable<Json>,"referenced_kind"?: string | null,"referenced_object_id"?: string | null,"search_vector"?: never,"text"?: string,"type": string,"updated_at"?: string
                  }
                  Update: {
                    "block_id"?: string,"depth"?: number,"object_id"?: string,"object_type"?: string,"organization_id"?: string,"parent_block_id"?: string | null,"position"?: number,"props"?: NonNullable<Json>,"referenced_kind"?: string | null,"referenced_object_id"?: string | null,"search_vector"?: never,"text"?: string,"type"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "block_object_id_fkey"
      columns: ["object_id"]
isOneToOne: false
      referencedRelation: "editor_document"
      referencedColumns: ["object_id"]
    },{
      foreignKeyName: "block_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"blueprint": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"approved_hash": string | null,"created_at": string,"created_by": string | null,"definition": NonNullable<Json>,"id": string,"key": string,"name_en": string,"name_fr": string,"organization_id": string,"status": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"approved_hash"?: string | null,"created_at"?: string,"created_by"?: string | null,"definition": NonNullable<Json>,"id"?: string,"key": string,"name_en": string,"name_fr": string,"organization_id": string,"status"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"approved_hash"?: string | null,"created_at"?: string,"created_by"?: string | null,"definition"?: NonNullable<Json>,"id"?: string,"key"?: string,"name_en"?: string,"name_fr"?: string,"organization_id"?: string,"status"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "blueprint_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "blueprint_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "blueprint_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "blueprint_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"blueprint_build": {
                  Row: {
                    "blueprint_id": string,"built_at": string,"built_by": string | null,"change_set_id": string,"changes": NonNullable<Json>,"counts": NonNullable<Json>,"id": string,"organization_id": string,"undo_change_set_id": string | null,"undone_at": string | null,"undone_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "blueprint_id": string,"built_at"?: string,"built_by"?: string | null,"change_set_id"?: string,"changes": NonNullable<Json>,"counts"?: NonNullable<Json>,"id"?: string,"organization_id": string,"undo_change_set_id"?: string | null,"undone_at"?: string | null,"undone_by"?: string | null
                  }
                  Update: {
                    "blueprint_id"?: string,"built_at"?: string,"built_by"?: string | null,"change_set_id"?: string,"changes"?: NonNullable<Json>,"counts"?: NonNullable<Json>,"id"?: string,"organization_id"?: string,"undo_change_set_id"?: string | null,"undone_at"?: string | null,"undone_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "blueprint_build_blueprint_id_fkey"
      columns: ["blueprint_id"]
isOneToOne: false
      referencedRelation: "blueprint"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "blueprint_build_built_by_fkey"
      columns: ["built_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "blueprint_build_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "blueprint_build_undone_by_fkey"
      columns: ["undone_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"budget": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"created_at": string,"created_by": string | null,"fiscal_year_start": string,"id": string,"name": string,"notes": string | null,"organization_id": string,"status": string,"superseded_at": string | null,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"fiscal_year_start": string,"id"?: string,"name": string,"notes"?: string | null,"organization_id": string,"status"?: string,"superseded_at"?: string | null,"updated_at"?: string,"version": number
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"fiscal_year_start"?: string,"id"?: string,"name"?: string,"notes"?: string | null,"organization_id"?: string,"status"?: string,"superseded_at"?: string | null,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "budget_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"budget_line": {
                  Row: {
                    "account_id": string,"annual_cents": number,"budget_id": string,"created_at": string,"fund_id": string | null,"id": string,"month_cents": (number)[],"note": string | null,"organization_id": string,"program_id": string | null,"project_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"annual_cents": number,"budget_id": string,"created_at"?: string,"fund_id"?: string | null,"id"?: string,"month_cents": (number)[],"note"?: string | null,"organization_id": string,"program_id"?: string | null,"project_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"annual_cents"?: number,"budget_id"?: string,"created_at"?: string,"fund_id"?: string | null,"id"?: string,"month_cents"?: (number)[],"note"?: string | null,"organization_id"?: string,"program_id"?: string | null,"project_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "budget_line_organization_id_account_id_fkey"
      columns: ["organization_id","account_id"]
isOneToOne: false
      referencedRelation: "ledger_account"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "budget_line_organization_id_budget_id_fkey"
      columns: ["organization_id","budget_id"]
isOneToOne: false
      referencedRelation: "budget"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "budget_line_organization_id_fund_id_fkey"
      columns: ["organization_id","fund_id"]
isOneToOne: false
      referencedRelation: "ledger_fund"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "budget_line_program_id_organization_id_fkey"
      columns: ["program_id","organization_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "budget_line_project_id_organization_id_fkey"
      columns: ["project_id","organization_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"calendar_event_link": {
                  Row: {
                    "connection_id": string,"created_at": string,"ends_at": string | null,"event_id": string | null,"external_id": string,"external_updated_at": string | null,"html_link": string | null,"id": string,"meeting_id": string | null,"organization_id": string,"starts_at": string,"title": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "connection_id": string,"created_at"?: string,"ends_at"?: string | null,"event_id"?: string | null,"external_id": string,"external_updated_at"?: string | null,"html_link"?: string | null,"id"?: string,"meeting_id"?: string | null,"organization_id": string,"starts_at": string,"title": string,"user_id": string
                  }
                  Update: {
                    "connection_id"?: string,"created_at"?: string,"ends_at"?: string | null,"event_id"?: string | null,"external_id"?: string,"external_updated_at"?: string | null,"html_link"?: string | null,"id"?: string,"meeting_id"?: string | null,"organization_id"?: string,"starts_at"?: string,"title"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "calendar_event_link_connection_id_fkey"
      columns: ["connection_id"]
isOneToOne: false
      referencedRelation: "integration_connection"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "calendar_event_link_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "calendar_event_link_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meeting"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "calendar_event_link_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "calendar_event_link_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"capture_forward": {
                  Row: {
                    "body": string | null,"created_at": string,"id": string,"organization_id": string,"received_at": string | null,"sender": string | null,"source": string,"source_id": string,"status": string,"title": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"created_at"?: string,"id"?: string,"organization_id": string,"received_at"?: string | null,"sender"?: string | null,"source": string,"source_id": string,"status"?: string,"title": string,"user_id"?: string
                  }
                  Update: {
                    "body"?: string | null,"created_at"?: string,"id"?: string,"organization_id"?: string,"received_at"?: string | null,"sender"?: string | null,"source"?: string,"source_id"?: string,"status"?: string,"title"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "capture_forward_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "capture_forward_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"capture_item": {
                  Row: {
                    "body": string | null,"created_at": string,"email_from": string | null,"email_subject": string | null,"file_name": string | null,"filed_as": string | null,"filed_at": string | null,"filed_project_id": string | null,"filed_ref_id": string | null,"id": string,"kind": string,"mime_type": string | null,"organization_id": string,"owner_id": string,"size_bytes": number | null,"status": string,"storage_path": string | null,"title": string,"updated_at": string,"url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"created_at"?: string,"email_from"?: string | null,"email_subject"?: string | null,"file_name"?: string | null,"filed_as"?: string | null,"filed_at"?: string | null,"filed_project_id"?: string | null,"filed_ref_id"?: string | null,"id"?: string,"kind": string,"mime_type"?: string | null,"organization_id": string,"owner_id": string,"size_bytes"?: number | null,"status"?: string,"storage_path"?: string | null,"title": string,"updated_at"?: string,"url"?: string | null
                  }
                  Update: {
                    "body"?: string | null,"created_at"?: string,"email_from"?: string | null,"email_subject"?: string | null,"file_name"?: string | null,"filed_as"?: string | null,"filed_at"?: string | null,"filed_project_id"?: string | null,"filed_ref_id"?: string | null,"id"?: string,"kind"?: string,"mime_type"?: string | null,"organization_id"?: string,"owner_id"?: string,"size_bytes"?: number | null,"status"?: string,"storage_path"?: string | null,"title"?: string,"updated_at"?: string,"url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "capture_item_filed_project_id_fkey"
      columns: ["filed_project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "capture_item_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "capture_item_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"change_set": {
                  Row: {
                    "action_key": string,"actor_id": string | null,"actor_kind": string,"created_at": string,"id": string,"organization_id": string,"undo_of": string | null,"undone_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action_key": string,"actor_id"?: string | null,"actor_kind": string,"created_at"?: string,"id"?: string,"organization_id": string,"undo_of"?: string | null,"undone_at"?: string | null
                  }
                  Update: {
                    "action_key"?: string,"actor_id"?: string | null,"actor_kind"?: string,"created_at"?: string,"id"?: string,"organization_id"?: string,"undo_of"?: string | null,"undone_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "change_set_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "change_set_undo_of_fkey"
      columns: ["undo_of"]
isOneToOne: false
      referencedRelation: "change_set"
      referencedColumns: ["id"]
    }
                  ]
                },"change_set_item": {
                  Row: {
                    "after": Json | null,"before": Json | null,"change_set_id": string,"kind": string,"object_id": string,"object_type": string,"position": number,"property": string | null,"relation_type_key": string | null,"to_id": string | null,"to_type": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "after"?: Json | null,"before"?: Json | null,"change_set_id": string,"kind": string,"object_id": string,"object_type": string,"position": number,"property"?: string | null,"relation_type_key"?: string | null,"to_id"?: string | null,"to_type"?: string | null
                  }
                  Update: {
                    "after"?: Json | null,"before"?: Json | null,"change_set_id"?: string,"kind"?: string,"object_id"?: string,"object_type"?: string,"position"?: number,"property"?: string | null,"relation_type_key"?: string | null,"to_id"?: string | null,"to_type"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "change_set_item_change_set_id_fkey"
      columns: ["change_set_id"]
isOneToOne: false
      referencedRelation: "change_set"
      referencedColumns: ["id"]
    }
                  ]
                },"channel": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"created_by": string | null,"event_id": string | null,"id": string,"is_mandatory": boolean,"name": string,"organization_id": string,"owner_id": string | null,"posting_policy": Database["public"]['Enums']["posting_policy"],"privacy": Database["public"]['Enums']["channel_privacy"],"program_id": string | null,"project_id": string | null,"purpose": string | null,"reply_policy": Database["public"]['Enums']["reply_policy"],"slug": string,"team_id": string | null,"topic": string | null,"type": Database["public"]['Enums']["channel_type"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"event_id"?: string | null,"id"?: string,"is_mandatory"?: boolean,"name": string,"organization_id": string,"owner_id"?: string | null,"posting_policy"?: Database["public"]['Enums']["posting_policy"],"privacy"?: Database["public"]['Enums']["channel_privacy"],"program_id"?: string | null,"project_id"?: string | null,"purpose"?: string | null,"reply_policy"?: Database["public"]['Enums']["reply_policy"],"slug": string,"team_id"?: string | null,"topic"?: string | null,"type"?: Database["public"]['Enums']["channel_type"],"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"event_id"?: string | null,"id"?: string,"is_mandatory"?: boolean,"name"?: string,"organization_id"?: string,"owner_id"?: string | null,"posting_policy"?: Database["public"]['Enums']["posting_policy"],"privacy"?: Database["public"]['Enums']["channel_privacy"],"program_id"?: string | null,"project_id"?: string | null,"purpose"?: string | null,"reply_policy"?: Database["public"]['Enums']["reply_policy"],"slug"?: string,"team_id"?: string | null,"topic"?: string | null,"type"?: Database["public"]['Enums']["channel_type"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "channel_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "channel_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "channel_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "channel_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "channel_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "channel_team_org_fk"
      columns: ["team_id","organization_id"]
isOneToOne: false
      referencedRelation: "team"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "fk_channel_event"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event"
      referencedColumns: ["id"]
    }
                  ]
                },"channel_access_grant": {
                  Row: {
                    "channel_id": string,"created_at": string,"created_by": string | null,"id": string,"organization_id": string,"role": string,"source": Database["public"]['Enums']["channel_access_source"],"source_team_id": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"organization_id": string,"role"?: string,"source": Database["public"]['Enums']["channel_access_source"],"source_team_id"?: string | null,"user_id": string
                  }
                  Update: {
                    "channel_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"organization_id"?: string,"role"?: string,"source"?: Database["public"]['Enums']["channel_access_source"],"source_team_id"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "channel_access_grant_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "channel"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "channel_access_grant_channel_org_fk"
      columns: ["channel_id","organization_id"]
isOneToOne: false
      referencedRelation: "channel"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "channel_access_grant_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "channel_access_grant_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "channel_access_grant_source_team_id_fkey"
      columns: ["source_team_id"]
isOneToOne: false
      referencedRelation: "team"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "channel_access_grant_target_membership_fk"
      columns: ["organization_id","user_id"]
isOneToOne: false
      referencedRelation: "organization_membership"
      referencedColumns: ["organization_id","user_id"]
    },{
      foreignKeyName: "channel_access_grant_team_member_fk"
      columns: ["source_team_id","user_id"]
isOneToOne: false
      referencedRelation: "team_member"
      referencedColumns: ["team_id","user_id"]
    },{
      foreignKeyName: "channel_access_grant_team_org_fk"
      columns: ["source_team_id","organization_id"]
isOneToOne: false
      referencedRelation: "team"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "channel_access_grant_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"channel_member": {
                  Row: {
                    "channel_id": string,"joined_at": string,"last_read_at": string,"membership_source": string,"muted_level": string,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel_id": string,"joined_at"?: string,"last_read_at"?: string,"membership_source"?: string,"muted_level"?: string,"role"?: string,"user_id": string
                  }
                  Update: {
                    "channel_id"?: string,"joined_at"?: string,"last_read_at"?: string,"membership_source"?: string,"muted_level"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "channel_member_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "channel"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "channel_member_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"checklist_item": {
                  Row: {
                    "completed_at": string | null,"created_at": string,"id": string,"sort_key": number,"task_id": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string | null,"created_at"?: string,"id"?: string,"sort_key"?: number,"task_id": string,"title": string
                  }
                  Update: {
                    "completed_at"?: string | null,"created_at"?: string,"id"?: string,"sort_key"?: number,"task_id"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "checklist_item_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "task"
      referencedColumns: ["id"]
    }
                  ]
                },"conversation": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"is_group": boolean,"organization_id": string,"title": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"is_group"?: boolean,"organization_id": string,"title"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"is_group"?: boolean,"organization_id"?: string,"title"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversation_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversation_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"conversation_member": {
                  Row: {
                    "conversation_id": string,"joined_at": string,"last_read_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "conversation_id": string,"joined_at"?: string,"last_read_at"?: string,"user_id": string
                  }
                  Update: {
                    "conversation_id"?: string,"joined_at"?: string,"last_read_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversation_member_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversation"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversation_member_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"crm_agreement": {
                  Row: {
                    "contact_id": string | null,"created_at": string,"created_by": string | null,"crm_organization_id": string,"ends_on": string | null,"id": string,"notes": string | null,"organization_id": string,"starts_on": string | null,"status": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"crm_organization_id": string,"ends_on"?: string | null,"id"?: string,"notes"?: string | null,"organization_id": string,"starts_on"?: string | null,"status"?: string,"title": string
                  }
                  Update: {
                    "contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"crm_organization_id"?: string,"ends_on"?: string | null,"id"?: string,"notes"?: string | null,"organization_id"?: string,"starts_on"?: string | null,"status"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "crm_agreement_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "crm_contact"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_agreement_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_agreement_crm_organization_id_fkey"
      columns: ["crm_organization_id"]
isOneToOne: false
      referencedRelation: "crm_organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_agreement_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"crm_contact": {
                  Row: {
                    "communication_notes": string | null,"created_at": string,"crm_organization_id": string | null,"details_edited_at": string | null,"email": string | null,"full_name": string,"id": string,"next_action_at": string | null,"notes": string | null,"organization_id": string,"owner_id": string | null,"phone": string | null,"preferred_channel": string | null,"role_title": string | null,"source": string,"status": string,"updated_at": string,"zeffy_contact_id": string | null,"zeffy_kinds": (string)[],"zeffy_last_activity_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "communication_notes"?: string | null,"created_at"?: string,"crm_organization_id"?: string | null,"details_edited_at"?: string | null,"email"?: string | null,"full_name": string,"id"?: string,"next_action_at"?: string | null,"notes"?: string | null,"organization_id": string,"owner_id"?: string | null,"phone"?: string | null,"preferred_channel"?: string | null,"role_title"?: string | null,"source"?: string,"status"?: string,"updated_at"?: string,"zeffy_contact_id"?: string | null,"zeffy_kinds"?: (string)[],"zeffy_last_activity_at"?: string | null
                  }
                  Update: {
                    "communication_notes"?: string | null,"created_at"?: string,"crm_organization_id"?: string | null,"details_edited_at"?: string | null,"email"?: string | null,"full_name"?: string,"id"?: string,"next_action_at"?: string | null,"notes"?: string | null,"organization_id"?: string,"owner_id"?: string | null,"phone"?: string | null,"preferred_channel"?: string | null,"role_title"?: string | null,"source"?: string,"status"?: string,"updated_at"?: string,"zeffy_contact_id"?: string | null,"zeffy_kinds"?: (string)[],"zeffy_last_activity_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "crm_contact_crm_organization_id_fkey"
      columns: ["crm_organization_id"]
isOneToOne: false
      referencedRelation: "crm_organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_contact_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_contact_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"crm_follow_up": {
                  Row: {
                    "completed_at": string | null,"contact_id": string | null,"created_at": string,"crm_organization_id": string | null,"due_at": string,"id": string,"organization_id": string,"owner_id": string,"status": Database["public"]['Enums']["follow_up_status"],"task_id": string | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string | null,"contact_id"?: string | null,"created_at"?: string,"crm_organization_id"?: string | null,"due_at": string,"id"?: string,"organization_id": string,"owner_id": string,"status"?: Database["public"]['Enums']["follow_up_status"],"task_id"?: string | null,"title": string
                  }
                  Update: {
                    "completed_at"?: string | null,"contact_id"?: string | null,"created_at"?: string,"crm_organization_id"?: string | null,"due_at"?: string,"id"?: string,"organization_id"?: string,"owner_id"?: string,"status"?: Database["public"]['Enums']["follow_up_status"],"task_id"?: string | null,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "crm_follow_up_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "crm_contact"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_follow_up_crm_organization_id_fkey"
      columns: ["crm_organization_id"]
isOneToOne: false
      referencedRelation: "crm_organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_follow_up_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_follow_up_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_follow_up_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "task"
      referencedColumns: ["id"]
    }
                  ]
                },"crm_interaction": {
                  Row: {
                    "contact_id": string | null,"created_at": string,"crm_organization_id": string | null,"document_id": string | null,"id": string,"interaction_type": Database["public"]['Enums']["interaction_type"],"next_steps": string | null,"occurred_at": string,"organization_id": string,"owner_id": string,"summary": string
                  }
                  ComputedFields: never
                  Insert: {
                    "contact_id"?: string | null,"created_at"?: string,"crm_organization_id"?: string | null,"document_id"?: string | null,"id"?: string,"interaction_type"?: Database["public"]['Enums']["interaction_type"],"next_steps"?: string | null,"occurred_at"?: string,"organization_id": string,"owner_id": string,"summary": string
                  }
                  Update: {
                    "contact_id"?: string | null,"created_at"?: string,"crm_organization_id"?: string | null,"document_id"?: string | null,"id"?: string,"interaction_type"?: Database["public"]['Enums']["interaction_type"],"next_steps"?: string | null,"occurred_at"?: string,"organization_id"?: string,"owner_id"?: string,"summary"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "crm_interaction_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "crm_contact"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_interaction_crm_organization_id_fkey"
      columns: ["crm_organization_id"]
isOneToOne: false
      referencedRelation: "crm_organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_interaction_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "document"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_interaction_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_interaction_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"crm_link": {
                  Row: {
                    "agreement_id": string | null,"contact_id": string | null,"created_at": string,"crm_organization_id": string | null,"event_id": string | null,"id": string,"opportunity_id": string | null,"organization_id": string,"program_id": string | null,"project_id": string | null,"task_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "agreement_id"?: string | null,"contact_id"?: string | null,"created_at"?: string,"crm_organization_id"?: string | null,"event_id"?: string | null,"id"?: string,"opportunity_id"?: string | null,"organization_id": string,"program_id"?: string | null,"project_id"?: string | null,"task_id"?: string | null
                  }
                  Update: {
                    "agreement_id"?: string | null,"contact_id"?: string | null,"created_at"?: string,"crm_organization_id"?: string | null,"event_id"?: string | null,"id"?: string,"opportunity_id"?: string | null,"organization_id"?: string,"program_id"?: string | null,"project_id"?: string | null,"task_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "crm_link_agreement_id_fkey"
      columns: ["agreement_id"]
isOneToOne: false
      referencedRelation: "crm_agreement"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_link_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "crm_contact"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_link_crm_organization_id_fkey"
      columns: ["crm_organization_id"]
isOneToOne: false
      referencedRelation: "crm_organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_link_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_link_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunity"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_link_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_link_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_link_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_link_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "task"
      referencedColumns: ["id"]
    }
                  ]
                },"crm_organization": {
                  Row: {
                    "category": string,"created_at": string,"created_by": string | null,"id": string,"name": string,"next_action_at": string | null,"notes": string | null,"organization_id": string,"owner_id": string | null,"status": string,"updated_at": string,"website": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "category"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"next_action_at"?: string | null,"notes"?: string | null,"organization_id": string,"owner_id"?: string | null,"status"?: string,"updated_at"?: string,"website"?: string | null
                  }
                  Update: {
                    "category"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"next_action_at"?: string | null,"notes"?: string | null,"organization_id"?: string,"owner_id"?: string | null,"status"?: string,"updated_at"?: string,"website"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "crm_organization_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_organization_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_organization_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"crm_sensitive_note": {
                  Row: {
                    "crm_contact_id": string | null,"crm_organization_id": string | null,"id": string,"notes": string,"organization_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "crm_contact_id"?: string | null,"crm_organization_id"?: string | null,"id"?: string,"notes": string,"organization_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "crm_contact_id"?: string | null,"crm_organization_id"?: string | null,"id"?: string,"notes"?: string,"organization_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "crm_sensitive_note_crm_contact_id_fkey"
      columns: ["crm_contact_id"]
isOneToOne: true
      referencedRelation: "crm_contact"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_sensitive_note_crm_organization_id_fkey"
      columns: ["crm_organization_id"]
isOneToOne: true
      referencedRelation: "crm_organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_sensitive_note_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crm_sensitive_note_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"decision": {
                  Row: {
                    "affected_records": NonNullable<Json>,"alternatives": string | null,"created_at": string,"decided_at": string,"decided_by": string | null,"detail": string | null,"evidence": string | null,"id": string,"meeting_id": string | null,"options_considered": NonNullable<Json>,"organization_id": string,"problem": string | null,"project_id": string | null,"reasoning": string | null,"reopen_conditions": string | null,"reopened_at": string | null,"revisit_on": string | null,"revisit_reminded_at": string | null,"source_message_id": string | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "affected_records"?: NonNullable<Json>,"alternatives"?: string | null,"created_at"?: string,"decided_at"?: string,"decided_by"?: string | null,"detail"?: string | null,"evidence"?: string | null,"id"?: string,"meeting_id"?: string | null,"options_considered"?: NonNullable<Json>,"organization_id": string,"problem"?: string | null,"project_id"?: string | null,"reasoning"?: string | null,"reopen_conditions"?: string | null,"reopened_at"?: string | null,"revisit_on"?: string | null,"revisit_reminded_at"?: string | null,"source_message_id"?: string | null,"title": string
                  }
                  Update: {
                    "affected_records"?: NonNullable<Json>,"alternatives"?: string | null,"created_at"?: string,"decided_at"?: string,"decided_by"?: string | null,"detail"?: string | null,"evidence"?: string | null,"id"?: string,"meeting_id"?: string | null,"options_considered"?: NonNullable<Json>,"organization_id"?: string,"problem"?: string | null,"project_id"?: string | null,"reasoning"?: string | null,"reopen_conditions"?: string | null,"reopened_at"?: string | null,"revisit_on"?: string | null,"revisit_reminded_at"?: string | null,"source_message_id"?: string | null,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "decision_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "decision_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meeting"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "decision_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "decision_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "decision_source_message_id_fkey"
      columns: ["source_message_id"]
isOneToOne: false
      referencedRelation: "message"
      referencedColumns: ["id"]
    }
                  ]
                },"decision_participant": {
                  Row: {
                    "added_by": string | null,"created_at": string,"decision_id": string,"organization_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_by"?: string | null,"created_at"?: string,"decision_id": string,"organization_id": string,"user_id": string
                  }
                  Update: {
                    "added_by"?: string | null,"created_at"?: string,"decision_id"?: string,"organization_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "decision_participant_added_by_fkey"
      columns: ["added_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "decision_participant_decision_id_fkey"
      columns: ["decision_id"]
isOneToOne: false
      referencedRelation: "decision"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "decision_participant_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "decision_participant_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"decision_request": {
                  Row: {
                    "assignee_id": string,"context": string,"created_at": string,"decision_id": string | null,"due_at": string,"id": string,"organization_id": string,"project_id": string,"requester_id": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assignee_id": string,"context": string,"created_at"?: string,"decision_id"?: string | null,"due_at": string,"id"?: string,"organization_id": string,"project_id": string,"requester_id": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "assignee_id"?: string,"context"?: string,"created_at"?: string,"decision_id"?: string | null,"due_at"?: string,"id"?: string,"organization_id"?: string,"project_id"?: string,"requester_id"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "decision_request_assignee_id_fkey"
      columns: ["assignee_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "decision_request_decision_id_fkey"
      columns: ["decision_id"]
isOneToOne: false
      referencedRelation: "decision"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "decision_request_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "decision_request_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "decision_request_requester_id_fkey"
      columns: ["requester_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"document": {
                  Row: {
                    "archived_at": string | null,"channel_id": string | null,"created_at": string,"created_by": string | null,"crm_organization_id": string | null,"description": string | null,"editor_object_id": string | null,"editor_object_type": string | null,"event_id": string | null,"external_id": string | null,"external_updated_at": string | null,"folder_id": string | null,"id": string,"integration_connection_id": string | null,"kind": Database["public"]['Enums']["document_kind"],"meeting_id": string | null,"mime_type": string | null,"organization_id": string,"owner_id": string | null,"program_id": string | null,"project_id": string | null,"quarantined_at": string | null,"record_category": string | null,"record_date": string | null,"requires_acknowledgement": boolean,"scan_attempted_at": string | null,"scan_note": string | null,"scan_status": string,"search_text": string,"series_id": string,"size_bytes": number | null,"storage_path": string | null,"superseded_at": string | null,"supersedes_id": string | null,"tags": (string)[],"template_id": string | null,"title": string,"updated_at": string,"url": string | null,"version_number": number,"visibility": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"channel_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"crm_organization_id"?: string | null,"description"?: string | null,"editor_object_id"?: string | null,"editor_object_type"?: string | null,"event_id"?: string | null,"external_id"?: string | null,"external_updated_at"?: string | null,"folder_id"?: string | null,"id"?: string,"integration_connection_id"?: string | null,"kind"?: Database["public"]['Enums']["document_kind"],"meeting_id"?: string | null,"mime_type"?: string | null,"organization_id": string,"owner_id"?: string | null,"program_id"?: string | null,"project_id"?: string | null,"quarantined_at"?: string | null,"record_category"?: string | null,"record_date"?: string | null,"requires_acknowledgement"?: boolean,"scan_attempted_at"?: string | null,"scan_note"?: string | null,"scan_status"?: string,"search_text"?: string,"series_id": string,"size_bytes"?: number | null,"storage_path"?: string | null,"superseded_at"?: string | null,"supersedes_id"?: string | null,"tags"?: (string)[],"template_id"?: string | null,"title": string,"updated_at"?: string,"url"?: string | null,"version_number"?: number,"visibility"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"channel_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"crm_organization_id"?: string | null,"description"?: string | null,"editor_object_id"?: string | null,"editor_object_type"?: string | null,"event_id"?: string | null,"external_id"?: string | null,"external_updated_at"?: string | null,"folder_id"?: string | null,"id"?: string,"integration_connection_id"?: string | null,"kind"?: Database["public"]['Enums']["document_kind"],"meeting_id"?: string | null,"mime_type"?: string | null,"organization_id"?: string,"owner_id"?: string | null,"program_id"?: string | null,"project_id"?: string | null,"quarantined_at"?: string | null,"record_category"?: string | null,"record_date"?: string | null,"requires_acknowledgement"?: boolean,"scan_attempted_at"?: string | null,"scan_note"?: string | null,"scan_status"?: string,"search_text"?: string,"series_id"?: string,"size_bytes"?: number | null,"storage_path"?: string | null,"superseded_at"?: string | null,"supersedes_id"?: string | null,"tags"?: (string)[],"template_id"?: string | null,"title"?: string,"updated_at"?: string,"url"?: string | null,"version_number"?: number,"visibility"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "channel"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_crm_organization_id_fkey"
      columns: ["crm_organization_id"]
isOneToOne: false
      referencedRelation: "crm_organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_folder_id_fkey"
      columns: ["folder_id"]
isOneToOne: false
      referencedRelation: "document_folder"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_integration_connection_id_fkey"
      columns: ["integration_connection_id"]
isOneToOne: false
      referencedRelation: "integration_connection"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meeting"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_record_category_fkey"
      columns: ["record_category"]
isOneToOne: false
      referencedRelation: "record_category"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "document_supersedes_id_fkey"
      columns: ["supersedes_id"]
isOneToOne: false
      referencedRelation: "document"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "document_template"
      referencedColumns: ["id"]
    }
                  ]
                },"document_acknowledgement": {
                  Row: {
                    "acknowledged_at": string,"document_id": string,"organization_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "acknowledged_at"?: string,"document_id": string,"organization_id": string,"user_id": string
                  }
                  Update: {
                    "acknowledged_at"?: string,"document_id"?: string,"organization_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_acknowledgement_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "document"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_acknowledgement_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_acknowledgement_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"document_folder": {
                  Row: {
                    "archived_at": string | null,"category": string,"created_at": string,"created_by": string | null,"description": string | null,"id": string,"name": string,"organization_id": string,"updated_at": string,"visibility": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"category": string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"name": string,"organization_id": string,"updated_at"?: string,"visibility"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"category"?: string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"name"?: string,"organization_id"?: string,"updated_at"?: string,"visibility"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_folder_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_folder_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"document_template": {
                  Row: {
                    "archived_at": string | null,"body": string,"created_at": string,"created_by": string | null,"folder_id": string | null,"id": string,"kind": string,"language": string,"name": string,"organization_id": string,"record_type": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"body": string,"created_at"?: string,"created_by"?: string | null,"folder_id"?: string | null,"id"?: string,"kind": string,"language": string,"name": string,"organization_id": string,"record_type": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "archived_at"?: string | null,"body"?: string,"created_at"?: string,"created_by"?: string | null,"folder_id"?: string | null,"id"?: string,"kind"?: string,"language"?: string,"name"?: string,"organization_id"?: string,"record_type"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_template_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_template_folder_id_fkey"
      columns: ["folder_id"]
isOneToOne: false
      referencedRelation: "document_folder"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_template_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_template_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"document_text": {
                  Row: {
                    "content": string,"document_id": string | null,"id": string,"organization_id": string,"receipt_id": string | null,"recorded_at": string,"recorded_by": string | null,"search_vector": unknown,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content": string,"document_id"?: string | null,"id"?: string,"organization_id": string,"receipt_id"?: string | null,"recorded_at"?: string,"recorded_by"?: string | null,"search_vector"?: never,"source": string
                  }
                  Update: {
                    "content"?: string,"document_id"?: string | null,"id"?: string,"organization_id"?: string,"receipt_id"?: string | null,"recorded_at"?: string,"recorded_by"?: string | null,"search_vector"?: never,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_text_document_id_fkey"
      columns: ["document_id"]
isOneToOne: true
      referencedRelation: "document"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_text_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_text_receipt_id_fkey"
      columns: ["receipt_id"]
isOneToOne: true
      referencedRelation: "finance_receipt"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "document_text_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"editor_document": {
                  Row: {
                    "content": NonNullable<Json>,"content_text": string,"created_at": string,"created_by": string,"object_id": string,"object_type": string,"organization_id": string,"updated_at": string,"updated_by": string | null,"version": number,"yjs_state": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "content"?: NonNullable<Json>,"content_text"?: string,"created_at"?: string,"created_by"?: string,"object_id": string,"object_type": string,"organization_id": string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number,"yjs_state"?: string | null
                  }
                  Update: {
                    "content"?: NonNullable<Json>,"content_text"?: string,"created_at"?: string,"created_by"?: string,"object_id"?: string,"object_type"?: string,"organization_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"version"?: number,"yjs_state"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "editor_document_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "editor_document_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "editor_document_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"editor_operation": {
                  Row: {
                    "actor_id": string | null,"base_version": number,"created_at": string,"id": string,"object_id": string,"object_type": string,"ops": NonNullable<Json>,"organization_id": string,"seq": number
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"base_version": number,"created_at"?: string,"id"?: string,"object_id": string,"object_type": string,"ops": NonNullable<Json>,"organization_id": string,"seq": number
                  }
                  Update: {
                    "actor_id"?: string | null,"base_version"?: number,"created_at"?: string,"id"?: string,"object_id"?: string,"object_type"?: string,"ops"?: NonNullable<Json>,"organization_id"?: string,"seq"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "editor_operation_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "editor_operation_object_id_fkey"
      columns: ["object_id"]
isOneToOne: false
      referencedRelation: "editor_document"
      referencedColumns: ["object_id"]
    },{
      foreignKeyName: "editor_operation_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"email_delivery": {
                  Row: {
                    "attempt": number,"body_html": string | null,"body_text": string | null,"category": string,"created_at": string,"dedupe_key": string,"id": string,"kind": string,"last_error": string | null,"notification_id": string | null,"organization_id": string,"provider": string | null,"provider_message_id": string | null,"recipient": string,"recipient_user_id": string | null,"scheduled_for": string | null,"sent_at": string | null,"status": string,"subject": string,"suppressed_reason": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempt"?: number,"body_html"?: string | null,"body_text"?: string | null,"category"?: string,"created_at"?: string,"dedupe_key": string,"id"?: string,"kind"?: string,"last_error"?: string | null,"notification_id"?: string | null,"organization_id": string,"provider"?: string | null,"provider_message_id"?: string | null,"recipient": string,"recipient_user_id"?: string | null,"scheduled_for"?: string | null,"sent_at"?: string | null,"status"?: string,"subject": string,"suppressed_reason"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "attempt"?: number,"body_html"?: string | null,"body_text"?: string | null,"category"?: string,"created_at"?: string,"dedupe_key"?: string,"id"?: string,"kind"?: string,"last_error"?: string | null,"notification_id"?: string | null,"organization_id"?: string,"provider"?: string | null,"provider_message_id"?: string | null,"recipient"?: string,"recipient_user_id"?: string | null,"scheduled_for"?: string | null,"sent_at"?: string | null,"status"?: string,"subject"?: string,"suppressed_reason"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "email_delivery_notification_id_fkey"
      columns: ["notification_id"]
isOneToOne: false
      referencedRelation: "notification"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "email_delivery_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "email_delivery_recipient_user_id_fkey"
      columns: ["recipient_user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"email_suppression": {
                  Row: {
                    "address": string,"created_at": string,"detail": string | null,"provider": string,"provider_event_id": string | null,"reason": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address": string,"created_at"?: string,"detail"?: string | null,"provider"?: string,"provider_event_id"?: string | null,"reason": string
                  }
                  Update: {
                    "address"?: string,"created_at"?: string,"detail"?: string | null,"provider"?: string,"provider_event_id"?: string | null,"reason"?: string
                  }
                  Relationships: [
                    
                  ]
                },"event": {
                  Row: {
                    "channel_id": string | null,"created_at": string,"created_by": string | null,"description": string | null,"ends_at": string | null,"event_type": string | null,"id": string,"location": string | null,"name": string,"organization_id": string,"owner_id": string | null,"program_id": string | null,"project_id": string | null,"starts_at": string,"status": Database["public"]['Enums']["event_status"],"updated_at": string,"volunteer_need": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "channel_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"ends_at"?: string | null,"event_type"?: string | null,"id"?: string,"location"?: string | null,"name": string,"organization_id": string,"owner_id"?: string | null,"program_id"?: string | null,"project_id"?: string | null,"starts_at": string,"status"?: Database["public"]['Enums']["event_status"],"updated_at"?: string,"volunteer_need"?: number | null
                  }
                  Update: {
                    "channel_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"ends_at"?: string | null,"event_type"?: string | null,"id"?: string,"location"?: string | null,"name"?: string,"organization_id"?: string,"owner_id"?: string | null,"program_id"?: string | null,"project_id"?: string | null,"starts_at"?: string,"status"?: Database["public"]['Enums']["event_status"],"updated_at"?: string,"volunteer_need"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "channel"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    }
                  ]
                },"event_assignment": {
                  Row: {
                    "created_at": string,"event_id": string,"id": string,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_id": string,"id"?: string,"role": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"event_id"?: string,"id"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_assignment_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_assignment_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"event_checklist_item": {
                  Row: {
                    "completed_at": string | null,"created_at": string,"event_id": string,"id": string,"sort_key": number,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string | null,"created_at"?: string,"event_id": string,"id"?: string,"sort_key"?: number,"title": string
                  }
                  Update: {
                    "completed_at"?: string | null,"created_at"?: string,"event_id"?: string,"id"?: string,"sort_key"?: number,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_checklist_item_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event"
      referencedColumns: ["id"]
    }
                  ]
                },"export_job": {
                  Row: {
                    "byte_size": number | null,"completed_at": string | null,"created_at": string,"download_count": number,"downloaded_at": string | null,"error": string | null,"expires_at": string,"id": string,"kind": Database["public"]['Enums']["export_kind"],"organization_id": string,"params": NonNullable<Json>,"requested_by": string,"row_count": number | null,"started_at": string | null,"status": Database["public"]['Enums']["export_status"],"storage_path": string | null,"subject_contact_id": string | null,"subject_user_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "byte_size"?: number | null,"completed_at"?: string | null,"created_at"?: string,"download_count"?: number,"downloaded_at"?: string | null,"error"?: string | null,"expires_at"?: string,"id"?: string,"kind": Database["public"]['Enums']["export_kind"],"organization_id": string,"params"?: NonNullable<Json>,"requested_by": string,"row_count"?: number | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["export_status"],"storage_path"?: string | null,"subject_contact_id"?: string | null,"subject_user_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "byte_size"?: number | null,"completed_at"?: string | null,"created_at"?: string,"download_count"?: number,"downloaded_at"?: string | null,"error"?: string | null,"expires_at"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["export_kind"],"organization_id"?: string,"params"?: NonNullable<Json>,"requested_by"?: string,"row_count"?: number | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["export_status"],"storage_path"?: string | null,"subject_contact_id"?: string | null,"subject_user_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "export_job_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "export_job_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "export_job_subject_contact_id_fkey"
      columns: ["subject_contact_id"]
isOneToOne: false
      referencedRelation: "crm_contact"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "export_job_subject_user_id_fkey"
      columns: ["subject_user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"feature_flag": {
                  Row: {
                    "description": string | null,"enabled": boolean,"key": string,"organization_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "description"?: string | null,"enabled"?: boolean,"key": string,"organization_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "description"?: string | null,"enabled"?: boolean,"key"?: string,"organization_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "feature_flag_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"finance_bill": {
                  Row: {
                    "approval_fingerprint": string | null,"approval_item_id": string | null,"bill_date": string,"created_at": string,"created_by": string | null,"due_date": string,"fund_id": string | null,"gst_cents": number,"id": string,"journal_entry_id": string | null,"memo": string | null,"organization_id": string,"paid_cents": number,"payable_account_id": string | null,"posted_at": string | null,"posted_by": string | null,"qst_cents": number,"receipt_id": string | null,"status": string,"subtotal_cents": number,"total_cents": number | null,"updated_at": string,"vendor_id": string,"vendor_reference": string | null,"void_entry_id": string | null,"voided_on": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "approval_fingerprint"?: string | null,"approval_item_id"?: string | null,"bill_date": string,"created_at"?: string,"created_by"?: string | null,"due_date": string,"fund_id"?: string | null,"gst_cents"?: number,"id"?: string,"journal_entry_id"?: string | null,"memo"?: string | null,"organization_id": string,"paid_cents"?: number,"payable_account_id"?: string | null,"posted_at"?: string | null,"posted_by"?: string | null,"qst_cents"?: number,"receipt_id"?: string | null,"status"?: string,"subtotal_cents"?: number,"total_cents"?: never,"updated_at"?: string,"vendor_id": string,"vendor_reference"?: string | null,"void_entry_id"?: string | null,"voided_on"?: string | null
                  }
                  Update: {
                    "approval_fingerprint"?: string | null,"approval_item_id"?: string | null,"bill_date"?: string,"created_at"?: string,"created_by"?: string | null,"due_date"?: string,"fund_id"?: string | null,"gst_cents"?: number,"id"?: string,"journal_entry_id"?: string | null,"memo"?: string | null,"organization_id"?: string,"paid_cents"?: number,"payable_account_id"?: string | null,"posted_at"?: string | null,"posted_by"?: string | null,"qst_cents"?: number,"receipt_id"?: string | null,"status"?: string,"subtotal_cents"?: number,"total_cents"?: never,"updated_at"?: string,"vendor_id"?: string,"vendor_reference"?: string | null,"void_entry_id"?: string | null,"voided_on"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "finance_bill_approval_item_id_fkey"
      columns: ["approval_item_id"]
isOneToOne: false
      referencedRelation: "approval_item"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_bill_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_bill_journal_entry_id_fkey"
      columns: ["journal_entry_id"]
isOneToOne: false
      referencedRelation: "journal_entry"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_bill_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_bill_organization_id_fund_id_fkey"
      columns: ["organization_id","fund_id"]
isOneToOne: false
      referencedRelation: "ledger_fund"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "finance_bill_organization_id_payable_account_id_fkey"
      columns: ["organization_id","payable_account_id"]
isOneToOne: false
      referencedRelation: "ledger_account"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "finance_bill_organization_id_vendor_id_fkey"
      columns: ["organization_id","vendor_id"]
isOneToOne: false
      referencedRelation: "finance_contact"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "finance_bill_posted_by_fkey"
      columns: ["posted_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_bill_receipt_id_fkey"
      columns: ["receipt_id"]
isOneToOne: false
      referencedRelation: "finance_receipt"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_bill_void_entry_id_fkey"
      columns: ["void_entry_id"]
isOneToOne: false
      referencedRelation: "journal_entry"
      referencedColumns: ["id"]
    }
                  ]
                },"finance_bill_line": {
                  Row: {
                    "account_id": string | null,"amount_cents": number,"bill_id": string,"description": string | null,"id": string,"line_no": number,"organization_id": string,"program_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"amount_cents": number,"bill_id": string,"description"?: string | null,"id"?: string,"line_no": number,"organization_id": string,"program_id"?: string | null
                  }
                  Update: {
                    "account_id"?: string | null,"amount_cents"?: number,"bill_id"?: string,"description"?: string | null,"id"?: string,"line_no"?: number,"organization_id"?: string,"program_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "finance_bill_line_organization_id_account_id_fkey"
      columns: ["organization_id","account_id"]
isOneToOne: false
      referencedRelation: "ledger_account"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "finance_bill_line_organization_id_bill_id_fkey"
      columns: ["organization_id","bill_id"]
isOneToOne: false
      referencedRelation: "finance_bill"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "finance_bill_line_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    }
                  ]
                },"finance_billing_settings": {
                  Row: {
                    "bill_approval_threshold_cents": number | null,"last_invoice_number": number,"organization_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bill_approval_threshold_cents"?: number | null,"last_invoice_number"?: number,"organization_id": string,"updated_at"?: string
                  }
                  Update: {
                    "bill_approval_threshold_cents"?: number | null,"last_invoice_number"?: number,"organization_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "finance_billing_settings_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: true
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"finance_contact": {
                  Row: {
                    "address": string | null,"created_at": string,"created_by": string | null,"email": string | null,"gst_number": string | null,"id": string,"is_active": boolean,"is_customer": boolean,"is_vendor": boolean,"language": string,"name": string,"notes": string | null,"organization_id": string,"phone": string | null,"qst_number": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"gst_number"?: string | null,"id"?: string,"is_active"?: boolean,"is_customer"?: boolean,"is_vendor"?: boolean,"language"?: string,"name": string,"notes"?: string | null,"organization_id": string,"phone"?: string | null,"qst_number"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"gst_number"?: string | null,"id"?: string,"is_active"?: boolean,"is_customer"?: boolean,"is_vendor"?: boolean,"language"?: string,"name"?: string,"notes"?: string | null,"organization_id"?: string,"phone"?: string | null,"qst_number"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "finance_contact_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_contact_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"finance_invoice": {
                  Row: {
                    "created_at": string,"created_by": string | null,"customer_id": string,"due_date": string,"fund_id": string | null,"gst_cents": number,"id": string,"invoice_date": string,"invoice_number": number | null,"journal_entry_id": string | null,"language": string,"memo": string | null,"organization_id": string,"paid_cents": number,"posted_at": string | null,"posted_by": string | null,"qst_cents": number,"receivable_account_id": string | null,"status": string,"subtotal_cents": number,"total_cents": number | null,"updated_at": string,"void_entry_id": string | null,"voided_on": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"customer_id": string,"due_date": string,"fund_id"?: string | null,"gst_cents"?: number,"id"?: string,"invoice_date": string,"invoice_number"?: number | null,"journal_entry_id"?: string | null,"language"?: string,"memo"?: string | null,"organization_id": string,"paid_cents"?: number,"posted_at"?: string | null,"posted_by"?: string | null,"qst_cents"?: number,"receivable_account_id"?: string | null,"status"?: string,"subtotal_cents"?: number,"total_cents"?: never,"updated_at"?: string,"void_entry_id"?: string | null,"voided_on"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"customer_id"?: string,"due_date"?: string,"fund_id"?: string | null,"gst_cents"?: number,"id"?: string,"invoice_date"?: string,"invoice_number"?: number | null,"journal_entry_id"?: string | null,"language"?: string,"memo"?: string | null,"organization_id"?: string,"paid_cents"?: number,"posted_at"?: string | null,"posted_by"?: string | null,"qst_cents"?: number,"receivable_account_id"?: string | null,"status"?: string,"subtotal_cents"?: number,"total_cents"?: never,"updated_at"?: string,"void_entry_id"?: string | null,"voided_on"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "finance_invoice_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_invoice_journal_entry_id_fkey"
      columns: ["journal_entry_id"]
isOneToOne: false
      referencedRelation: "journal_entry"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_invoice_organization_id_customer_id_fkey"
      columns: ["organization_id","customer_id"]
isOneToOne: false
      referencedRelation: "finance_contact"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "finance_invoice_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_invoice_organization_id_fund_id_fkey"
      columns: ["organization_id","fund_id"]
isOneToOne: false
      referencedRelation: "ledger_fund"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "finance_invoice_organization_id_receivable_account_id_fkey"
      columns: ["organization_id","receivable_account_id"]
isOneToOne: false
      referencedRelation: "ledger_account"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "finance_invoice_posted_by_fkey"
      columns: ["posted_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_invoice_void_entry_id_fkey"
      columns: ["void_entry_id"]
isOneToOne: false
      referencedRelation: "journal_entry"
      referencedColumns: ["id"]
    }
                  ]
                },"finance_invoice_line": {
                  Row: {
                    "account_id": string | null,"amount_cents": number,"description": string,"id": string,"invoice_id": string,"line_no": number,"organization_id": string,"program_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"amount_cents": number,"description": string,"id"?: string,"invoice_id": string,"line_no": number,"organization_id": string,"program_id"?: string | null
                  }
                  Update: {
                    "account_id"?: string | null,"amount_cents"?: number,"description"?: string,"id"?: string,"invoice_id"?: string,"line_no"?: number,"organization_id"?: string,"program_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "finance_invoice_line_organization_id_account_id_fkey"
      columns: ["organization_id","account_id"]
isOneToOne: false
      referencedRelation: "ledger_account"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "finance_invoice_line_organization_id_invoice_id_fkey"
      columns: ["organization_id","invoice_id"]
isOneToOne: false
      referencedRelation: "finance_invoice"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "finance_invoice_line_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    }
                  ]
                },"finance_payment": {
                  Row: {
                    "amount_cents": number,"bank_account_id": string,"bill_id": string | null,"created_at": string,"created_by": string | null,"id": string,"invoice_id": string | null,"journal_entry_id": string,"method": string,"organization_id": string,"paid_on": string,"reference": string | null,"reversal_entry_id": string | null,"reversed_on": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"bank_account_id": string,"bill_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"invoice_id"?: string | null,"journal_entry_id": string,"method": string,"organization_id": string,"paid_on": string,"reference"?: string | null,"reversal_entry_id"?: string | null,"reversed_on"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"bank_account_id"?: string,"bill_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"invoice_id"?: string | null,"journal_entry_id"?: string,"method"?: string,"organization_id"?: string,"paid_on"?: string,"reference"?: string | null,"reversal_entry_id"?: string | null,"reversed_on"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "finance_payment_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_payment_journal_entry_id_fkey"
      columns: ["journal_entry_id"]
isOneToOne: false
      referencedRelation: "journal_entry"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_payment_organization_id_bank_account_id_fkey"
      columns: ["organization_id","bank_account_id"]
isOneToOne: false
      referencedRelation: "ledger_account"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "finance_payment_organization_id_bill_id_fkey"
      columns: ["organization_id","bill_id"]
isOneToOne: false
      referencedRelation: "finance_bill"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "finance_payment_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_payment_organization_id_invoice_id_fkey"
      columns: ["organization_id","invoice_id"]
isOneToOne: false
      referencedRelation: "finance_invoice"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "finance_payment_reversal_entry_id_fkey"
      columns: ["reversal_entry_id"]
isOneToOne: false
      referencedRelation: "journal_entry"
      referencedColumns: ["id"]
    }
                  ]
                },"finance_receipt": {
                  Row: {
                    "created_at": string,"document_date": string,"file_name": string,"gst_cents": number,"id": string,"kind": string,"mime_type": string | null,"note": string | null,"organization_id": string,"program_id": string | null,"project_id": string | null,"qst_cents": number,"quarantined_at": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"scan_attempted_at": string | null,"scan_note": string | null,"scan_status": string,"size_bytes": number | null,"status": string,"storage_path": string,"submitted_by": string,"total_cents": number,"updated_at": string,"vendor": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"document_date": string,"file_name": string,"gst_cents"?: number,"id"?: string,"kind"?: string,"mime_type"?: string | null,"note"?: string | null,"organization_id": string,"program_id"?: string | null,"project_id"?: string | null,"qst_cents"?: number,"quarantined_at"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"scan_attempted_at"?: string | null,"scan_note"?: string | null,"scan_status"?: string,"size_bytes"?: number | null,"status"?: string,"storage_path": string,"submitted_by"?: string,"total_cents": number,"updated_at"?: string,"vendor": string
                  }
                  Update: {
                    "created_at"?: string,"document_date"?: string,"file_name"?: string,"gst_cents"?: number,"id"?: string,"kind"?: string,"mime_type"?: string | null,"note"?: string | null,"organization_id"?: string,"program_id"?: string | null,"project_id"?: string | null,"qst_cents"?: number,"quarantined_at"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"scan_attempted_at"?: string | null,"scan_note"?: string | null,"scan_status"?: string,"size_bytes"?: number | null,"status"?: string,"storage_path"?: string,"submitted_by"?: string,"total_cents"?: number,"updated_at"?: string,"vendor"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "finance_receipt_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_receipt_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_receipt_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_receipt_reviewed_by_fkey"
      columns: ["reviewed_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "finance_receipt_submitted_by_fkey"
      columns: ["submitted_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"follow_event_cursor": {
                  Row: {
                    "consumer": string,"last_created_at": string,"last_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "consumer": string,"last_created_at"?: string,"last_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "consumer"?: string,"last_created_at"?: string,"last_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"follow_rule_v2": {
                  Row: {
                    "email": string,"event_kind": string,"in_app": boolean,"organization_id": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "email"?: string,"event_kind": string,"in_app"?: boolean,"organization_id": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "email"?: string,"event_kind"?: string,"in_app"?: boolean,"organization_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "follow_rule_v2_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "follow_rule_v2_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"follow_v2": {
                  Row: {
                    "created_at": string,"id": string,"label": string | null,"object_id": string | null,"object_type": string | null,"organization_id": string,"query_spec": Json | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"label"?: string | null,"object_id"?: string | null,"object_type"?: string | null,"organization_id": string,"query_spec"?: Json | null,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"label"?: string | null,"object_id"?: string | null,"object_type"?: string | null,"organization_id"?: string,"query_spec"?: Json | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "follow_v2_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "follow_v2_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"form_definition": {
                  Row: {
                    "audience": string,"created_at": string,"created_by": string,"description": string | null,"fields": NonNullable<Json>,"id": string,"organization_id": string,"published_at": string | null,"published_by": string | null,"requires_signature": boolean,"status": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "audience"?: string,"created_at"?: string,"created_by"?: string,"description"?: string | null,"fields"?: NonNullable<Json>,"id"?: string,"organization_id": string,"published_at"?: string | null,"published_by"?: string | null,"requires_signature"?: boolean,"status"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "audience"?: string,"created_at"?: string,"created_by"?: string,"description"?: string | null,"fields"?: NonNullable<Json>,"id"?: string,"organization_id"?: string,"published_at"?: string | null,"published_by"?: string | null,"requires_signature"?: boolean,"status"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "form_definition_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "form_definition_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "form_definition_published_by_fkey"
      columns: ["published_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"form_file": {
                  Row: {
                    "content_sha256": string | null,"created_at": string,"field_key": string,"file_name": string,"id": string,"mime_type": string | null,"organization_id": string,"quarantined_at": string | null,"scan_attempted_at": string | null,"scan_note": string | null,"scan_status": string,"size_bytes": number | null,"storage_path": string,"submission_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content_sha256"?: string | null,"created_at"?: string,"field_key": string,"file_name": string,"id"?: string,"mime_type"?: string | null,"organization_id": string,"quarantined_at"?: string | null,"scan_attempted_at"?: string | null,"scan_note"?: string | null,"scan_status"?: string,"size_bytes"?: number | null,"storage_path": string,"submission_id": string
                  }
                  Update: {
                    "content_sha256"?: string | null,"created_at"?: string,"field_key"?: string,"file_name"?: string,"id"?: string,"mime_type"?: string | null,"organization_id"?: string,"quarantined_at"?: string | null,"scan_attempted_at"?: string | null,"scan_note"?: string | null,"scan_status"?: string,"size_bytes"?: number | null,"storage_path"?: string,"submission_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "form_file_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "form_file_submission_id_fkey"
      columns: ["submission_id"]
isOneToOne: false
      referencedRelation: "form_submission"
      referencedColumns: ["id"]
    }
                  ]
                },"form_submission": {
                  Row: {
                    "answers": NonNullable<Json>,"content_sha256": string,"form_id": string,"id": string,"organization_id": string,"submitted_at": string,"submitted_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answers": NonNullable<Json>,"content_sha256": string,"form_id": string,"id"?: string,"organization_id": string,"submitted_at"?: string,"submitted_by"?: string
                  }
                  Update: {
                    "answers"?: NonNullable<Json>,"content_sha256"?: string,"form_id"?: string,"id"?: string,"organization_id"?: string,"submitted_at"?: string,"submitted_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "form_submission_form_id_fkey"
      columns: ["form_id"]
isOneToOne: false
      referencedRelation: "form_definition"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "form_submission_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "form_submission_submitted_by_fkey"
      columns: ["submitted_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"form_v2": {
                  Row: {
                    "audience": string,"created_at": string,"created_by": string | null,"description_en": string | null,"description_fr": string | null,"id": string,"legacy_form_id": string | null,"organization_id": string,"properties": NonNullable<Json>,"published_at": string | null,"status": string,"target_project_id": string | null,"title_en": string,"title_fr": string,"type_key": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "audience"?: string,"created_at"?: string,"created_by"?: string | null,"description_en"?: string | null,"description_fr"?: string | null,"id"?: string,"legacy_form_id"?: string | null,"organization_id": string,"properties"?: NonNullable<Json>,"published_at"?: string | null,"status"?: string,"target_project_id"?: string | null,"title_en": string,"title_fr": string,"type_key": string,"updated_at"?: string
                  }
                  Update: {
                    "audience"?: string,"created_at"?: string,"created_by"?: string | null,"description_en"?: string | null,"description_fr"?: string | null,"id"?: string,"legacy_form_id"?: string | null,"organization_id"?: string,"properties"?: NonNullable<Json>,"published_at"?: string | null,"status"?: string,"target_project_id"?: string | null,"title_en"?: string,"title_fr"?: string,"type_key"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "form_v2_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "form_v2_legacy_form_id_fkey"
      columns: ["legacy_form_id"]
isOneToOne: true
      referencedRelation: "form_definition"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "form_v2_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "form_v2_target_project_id_fkey"
      columns: ["target_project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    }
                  ]
                },"form_v2_response": {
                  Row: {
                    "answers": NonNullable<Json>,"created_object_id": string | null,"created_object_type": string | null,"form_id": string,"id": string,"legacy_submission_id": string | null,"object_id": string,"object_type": string,"organization_id": string,"submitted_at": string,"submitted_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "answers": NonNullable<Json>,"created_object_id"?: string | null,"created_object_type"?: string | null,"form_id": string,"id"?: string,"legacy_submission_id"?: string | null,"object_id": string,"object_type": string,"organization_id": string,"submitted_at"?: string,"submitted_by"?: string | null
                  }
                  Update: {
                    "answers"?: NonNullable<Json>,"created_object_id"?: string | null,"created_object_type"?: string | null,"form_id"?: string,"id"?: string,"legacy_submission_id"?: string | null,"object_id"?: string,"object_type"?: string,"organization_id"?: string,"submitted_at"?: string,"submitted_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "form_v2_response_form_id_fkey"
      columns: ["form_id"]
isOneToOne: false
      referencedRelation: "form_v2"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "form_v2_response_legacy_submission_id_fkey"
      columns: ["legacy_submission_id"]
isOneToOne: true
      referencedRelation: "form_submission"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "form_v2_response_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "form_v2_response_submitted_by_fkey"
      columns: ["submitted_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"gift": {
                  Row: {
                    "amount_cents": number | null,"created_at": string,"created_by": string | null,"credit_account_id": string | null,"crm_contact_id": string | null,"crm_organization_id": string | null,"debit_account_id": string | null,"donor_restriction": string | null,"fund_id": string,"gift_number": number,"gift_type": string,"grant_id": string | null,"id": string,"in_kind_description": string | null,"journal_entry_id": string | null,"note": string | null,"organization_id": string,"program_id": string | null,"received_on": string,"status": string,"value_supplied_by_donor": boolean,"void_entry_id": string | null,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: number | null,"created_at"?: string,"created_by"?: string | null,"credit_account_id"?: string | null,"crm_contact_id"?: string | null,"crm_organization_id"?: string | null,"debit_account_id"?: string | null,"donor_restriction"?: string | null,"fund_id": string,"gift_number": number,"gift_type": string,"grant_id"?: string | null,"id"?: string,"in_kind_description"?: string | null,"journal_entry_id"?: string | null,"note"?: string | null,"organization_id": string,"program_id"?: string | null,"received_on": string,"status"?: string,"value_supplied_by_donor"?: boolean,"void_entry_id"?: string | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number | null,"created_at"?: string,"created_by"?: string | null,"credit_account_id"?: string | null,"crm_contact_id"?: string | null,"crm_organization_id"?: string | null,"debit_account_id"?: string | null,"donor_restriction"?: string | null,"fund_id"?: string,"gift_number"?: number,"gift_type"?: string,"grant_id"?: string | null,"id"?: string,"in_kind_description"?: string | null,"journal_entry_id"?: string | null,"note"?: string | null,"organization_id"?: string,"program_id"?: string | null,"received_on"?: string,"status"?: string,"value_supplied_by_donor"?: boolean,"void_entry_id"?: string | null,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "gift_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gift_crm_contact_id_fkey"
      columns: ["crm_contact_id"]
isOneToOne: false
      referencedRelation: "crm_contact"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gift_crm_organization_id_fkey"
      columns: ["crm_organization_id"]
isOneToOne: false
      referencedRelation: "crm_organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gift_organization_id_credit_account_id_fkey"
      columns: ["organization_id","credit_account_id"]
isOneToOne: false
      referencedRelation: "ledger_account"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "gift_organization_id_debit_account_id_fkey"
      columns: ["organization_id","debit_account_id"]
isOneToOne: false
      referencedRelation: "ledger_account"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "gift_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gift_organization_id_fund_id_fkey"
      columns: ["organization_id","fund_id"]
isOneToOne: false
      referencedRelation: "ledger_fund"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "gift_organization_id_grant_id_fkey"
      columns: ["organization_id","grant_id"]
isOneToOne: false
      referencedRelation: "grant_award"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "gift_organization_id_journal_entry_id_fkey"
      columns: ["organization_id","journal_entry_id"]
isOneToOne: false
      referencedRelation: "journal_entry"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "gift_organization_id_void_entry_id_fkey"
      columns: ["organization_id","void_entry_id"]
isOneToOne: false
      referencedRelation: "journal_entry"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "gift_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gift_voided_by_fkey"
      columns: ["voided_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"gift_acknowledgement": {
                  Row: {
                    "body_text": string,"channel": string,"created_at": string,"created_by": string | null,"crm_contact_id": string | null,"crm_organization_id": string | null,"email_error": string | null,"email_status": string | null,"gift_id": string | null,"id": string,"kind": string,"language": string,"organization_id": string,"recipient_email": string | null,"recipient_name": string,"sent_at": string | null,"statement_year": number | null,"subject": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body_text": string,"channel": string,"created_at"?: string,"created_by"?: string | null,"crm_contact_id"?: string | null,"crm_organization_id"?: string | null,"email_error"?: string | null,"email_status"?: string | null,"gift_id"?: string | null,"id"?: string,"kind": string,"language": string,"organization_id": string,"recipient_email"?: string | null,"recipient_name": string,"sent_at"?: string | null,"statement_year"?: number | null,"subject": string
                  }
                  Update: {
                    "body_text"?: string,"channel"?: string,"created_at"?: string,"created_by"?: string | null,"crm_contact_id"?: string | null,"crm_organization_id"?: string | null,"email_error"?: string | null,"email_status"?: string | null,"gift_id"?: string | null,"id"?: string,"kind"?: string,"language"?: string,"organization_id"?: string,"recipient_email"?: string | null,"recipient_name"?: string,"sent_at"?: string | null,"statement_year"?: number | null,"subject"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "gift_acknowledgement_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gift_acknowledgement_crm_contact_id_fkey"
      columns: ["crm_contact_id"]
isOneToOne: false
      referencedRelation: "crm_contact"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gift_acknowledgement_crm_organization_id_fkey"
      columns: ["crm_organization_id"]
isOneToOne: false
      referencedRelation: "crm_organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gift_acknowledgement_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gift_acknowledgement_organization_id_gift_id_fkey"
      columns: ["organization_id","gift_id"]
isOneToOne: false
      referencedRelation: "gift"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"gmail_message": {
                  Row: {
                    "connection_id": string,"created_at": string,"external_id": string,"from_address": string | null,"id": string,"organization_id": string,"received_at": string | null,"snippet": string | null,"subject": string | null,"thread_id": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "connection_id": string,"created_at"?: string,"external_id": string,"from_address"?: string | null,"id"?: string,"organization_id": string,"received_at"?: string | null,"snippet"?: string | null,"subject"?: string | null,"thread_id"?: string | null,"user_id": string
                  }
                  Update: {
                    "connection_id"?: string,"created_at"?: string,"external_id"?: string,"from_address"?: string | null,"id"?: string,"organization_id"?: string,"received_at"?: string | null,"snippet"?: string | null,"subject"?: string | null,"thread_id"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "gmail_message_connection_id_fkey"
      columns: ["connection_id"]
isOneToOne: false
      referencedRelation: "integration_connection"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gmail_message_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "gmail_message_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"goal": {
                  Row: {
                    "created_at": string,"created_by": string | null,"description": string | null,"id": string,"organization_id": string,"owner_id": string | null,"program_id": string | null,"status": string,"target_on": string | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"organization_id": string,"owner_id"?: string | null,"program_id"?: string | null,"status"?: string,"target_on"?: string | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"organization_id"?: string,"owner_id"?: string | null,"program_id"?: string | null,"status"?: string,"target_on"?: string | null,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "goal_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "goal_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "goal_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "goal_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    }
                  ]
                },"goal_metric": {
                  Row: {
                    "created_at": string,"goal_id": string,"metric_id": string,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"goal_id": string,"metric_id": string,"organization_id": string
                  }
                  Update: {
                    "created_at"?: string,"goal_id"?: string,"metric_id"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "goal_metric_goal_id_fkey"
      columns: ["goal_id"]
isOneToOne: false
      referencedRelation: "goal"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "goal_metric_metric_id_fkey"
      columns: ["metric_id"]
isOneToOne: false
      referencedRelation: "outcome_metric"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "goal_metric_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"goal_project": {
                  Row: {
                    "created_at": string,"goal_id": string,"organization_id": string,"project_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"goal_id": string,"organization_id": string,"project_id": string
                  }
                  Update: {
                    "created_at"?: string,"goal_id"?: string,"organization_id"?: string,"project_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "goal_project_goal_id_fkey"
      columns: ["goal_id"]
isOneToOne: false
      referencedRelation: "goal"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "goal_project_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "goal_project_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    }
                  ]
                },"google_token_revocation": {
                  Row: {
                    "attempts": number,"connection_id": string,"id": string,"organization_id": string | null,"provider": string | null,"queued_at": string,"token": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"connection_id": string,"id"?: string,"organization_id"?: string | null,"provider"?: string | null,"queued_at"?: string,"token": string,"user_id"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"connection_id"?: string,"id"?: string,"organization_id"?: string | null,"provider"?: string | null,"queued_at"?: string,"token"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"grant_award": {
                  Row: {
                    "amount_awarded_cents": number,"awarded_on": string | null,"created_at": string,"created_by": string | null,"ends_on": string | null,"fund_id": string,"funder_contact_id": string | null,"funder_crm_organization_id": string,"funder_reference": string | null,"id": string,"organization_id": string,"program_id": string | null,"responsible_user_id": string | null,"restrictions": string | null,"starts_on": string | null,"status": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_awarded_cents": number,"awarded_on"?: string | null,"created_at"?: string,"created_by"?: string | null,"ends_on"?: string | null,"fund_id": string,"funder_contact_id"?: string | null,"funder_crm_organization_id": string,"funder_reference"?: string | null,"id"?: string,"organization_id": string,"program_id"?: string | null,"responsible_user_id"?: string | null,"restrictions"?: string | null,"starts_on"?: string | null,"status"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_awarded_cents"?: number,"awarded_on"?: string | null,"created_at"?: string,"created_by"?: string | null,"ends_on"?: string | null,"fund_id"?: string,"funder_contact_id"?: string | null,"funder_crm_organization_id"?: string,"funder_reference"?: string | null,"id"?: string,"organization_id"?: string,"program_id"?: string | null,"responsible_user_id"?: string | null,"restrictions"?: string | null,"starts_on"?: string | null,"status"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "grant_award_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "grant_award_funder_contact_id_fkey"
      columns: ["funder_contact_id"]
isOneToOne: false
      referencedRelation: "crm_contact"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "grant_award_funder_crm_organization_id_fkey"
      columns: ["funder_crm_organization_id"]
isOneToOne: false
      referencedRelation: "crm_organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "grant_award_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "grant_award_organization_id_fund_id_fkey"
      columns: ["organization_id","fund_id"]
isOneToOne: false
      referencedRelation: "ledger_fund"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "grant_award_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "grant_award_responsible_user_id_fkey"
      columns: ["responsible_user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"grant_report": {
                  Row: {
                    "created_at": string,"created_by": string | null,"due_on": string,"grant_id": string,"id": string,"last_reminded_at": string | null,"last_reminder_kind": string | null,"notes": string | null,"organization_id": string,"submitted_on": string | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"due_on": string,"grant_id": string,"id"?: string,"last_reminded_at"?: string | null,"last_reminder_kind"?: string | null,"notes"?: string | null,"organization_id": string,"submitted_on"?: string | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"due_on"?: string,"grant_id"?: string,"id"?: string,"last_reminded_at"?: string | null,"last_reminder_kind"?: string | null,"notes"?: string | null,"organization_id"?: string,"submitted_on"?: string | null,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "grant_report_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "grant_report_organization_id_grant_id_fkey"
      columns: ["organization_id","grant_id"]
isOneToOne: false
      referencedRelation: "grant_award"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"home_visit": {
                  Row: {
                    "away_since": string | null,"last_seen_at": string,"organization_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "away_since"?: string | null,"last_seen_at"?: string,"organization_id": string,"user_id": string
                  }
                  Update: {
                    "away_since"?: string | null,"last_seen_at"?: string,"organization_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "home_visit_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "home_visit_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"integration_connection": {
                  Row: {
                    "created_at": string,"external_account_id": string | null,"id": string,"last_error": string | null,"last_sync_at": string | null,"organization_id": string,"provider": string,"scopes": (string)[] | null,"status": string,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"external_account_id"?: string | null,"id"?: string,"last_error"?: string | null,"last_sync_at"?: string | null,"organization_id": string,"provider": string,"scopes"?: (string)[] | null,"status"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"external_account_id"?: string | null,"id"?: string,"last_error"?: string | null,"last_sync_at"?: string | null,"organization_id"?: string,"provider"?: string,"scopes"?: (string)[] | null,"status"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "integration_connection_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "integration_connection_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"integration_secret": {
                  Row: {
                    "access_token": string | null,"connection_id": string,"gmail_history_id": string | null,"gmail_last_push_at": string | null,"gmail_pending_history_id": string | null,"gmail_watch_expiration_at": string | null,"google_calendar_sync_token": string | null,"google_drive_page_token": string | null,"refresh_token": string | null,"sync_cursor": string | null,"token_expires_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_token"?: string | null,"connection_id": string,"gmail_history_id"?: string | null,"gmail_last_push_at"?: string | null,"gmail_pending_history_id"?: string | null,"gmail_watch_expiration_at"?: string | null,"google_calendar_sync_token"?: string | null,"google_drive_page_token"?: string | null,"refresh_token"?: string | null,"sync_cursor"?: string | null,"token_expires_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "access_token"?: string | null,"connection_id"?: string,"gmail_history_id"?: string | null,"gmail_last_push_at"?: string | null,"gmail_pending_history_id"?: string | null,"gmail_watch_expiration_at"?: string | null,"google_calendar_sync_token"?: string | null,"google_drive_page_token"?: string | null,"refresh_token"?: string | null,"sync_cursor"?: string | null,"token_expires_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "integration_secret_connection_id_fkey"
      columns: ["connection_id"]
isOneToOne: true
      referencedRelation: "integration_connection"
      referencedColumns: ["id"]
    }
                  ]
                },"invitation": {
                  Row: {
                    "accepted_at": string | null,"created_at": string,"email": string,"expires_at": string,"id": string,"intended_role": Database["public"]['Enums']["org_role"],"invited_by": string,"organization_id": string,"revoked_at": string | null,"token": string,"token_hash": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"created_at"?: string,"email": string,"expires_at"?: string,"id"?: string,"intended_role"?: Database["public"]['Enums']["org_role"],"invited_by": string,"organization_id": string,"revoked_at"?: string | null,"token"?: string,"token_hash"?: string | null
                  }
                  Update: {
                    "accepted_at"?: string | null,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"intended_role"?: Database["public"]['Enums']["org_role"],"invited_by"?: string,"organization_id"?: string,"revoked_at"?: string | null,"token"?: string,"token_hash"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitation_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitation_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"issue": {
                  Row: {
                    "created_at": string,"created_by": string | null,"description": string | null,"due_at": string | null,"id": string,"impact": string | null,"organization_id": string,"owner_id": string | null,"project_id": string,"resolution": string | null,"resolution_plan": string | null,"resolved_at": string | null,"risk_id": string | null,"severity": Database["public"]['Enums']["issue_severity"],"status": Database["public"]['Enums']["issue_status"],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"due_at"?: string | null,"id"?: string,"impact"?: string | null,"organization_id": string,"owner_id"?: string | null,"project_id": string,"resolution"?: string | null,"resolution_plan"?: string | null,"resolved_at"?: string | null,"risk_id"?: string | null,"severity"?: Database["public"]['Enums']["issue_severity"],"status"?: Database["public"]['Enums']["issue_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"due_at"?: string | null,"id"?: string,"impact"?: string | null,"organization_id"?: string,"owner_id"?: string | null,"project_id"?: string,"resolution"?: string | null,"resolution_plan"?: string | null,"resolved_at"?: string | null,"risk_id"?: string | null,"severity"?: Database["public"]['Enums']["issue_severity"],"status"?: Database["public"]['Enums']["issue_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "issue_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "issue_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "issue_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "issue_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "issue_risk_id_fkey"
      columns: ["risk_id"]
isOneToOne: false
      referencedRelation: "risk"
      referencedColumns: ["id"]
    }
                  ]
                },"job_definition": {
                  Row: {
                    "batch_size": number,"created_at": string,"description": string,"enabled": boolean,"max_attempts": number,"name": string,"queue": string | null,"schedule": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "batch_size"?: number,"created_at"?: string,"description": string,"enabled"?: boolean,"max_attempts"?: number,"name": string,"queue"?: string | null,"schedule": string,"updated_at"?: string
                  }
                  Update: {
                    "batch_size"?: number,"created_at"?: string,"description"?: string,"enabled"?: boolean,"max_attempts"?: number,"name"?: string,"queue"?: string | null,"schedule"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"job_run": {
                  Row: {
                    "duration_ms": number | null,"error": string | null,"failed_count": number,"finished_at": string | null,"id": string,"job_name": string,"metadata": NonNullable<Json>,"processed_count": number,"started_at": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "duration_ms"?: number | null,"error"?: string | null,"failed_count"?: number,"finished_at"?: string | null,"id"?: string,"job_name": string,"metadata"?: NonNullable<Json>,"processed_count"?: number,"started_at"?: string,"status"?: string
                  }
                  Update: {
                    "duration_ms"?: number | null,"error"?: string | null,"failed_count"?: number,"finished_at"?: string | null,"id"?: string,"job_name"?: string,"metadata"?: NonNullable<Json>,"processed_count"?: number,"started_at"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "job_run_job_name_fkey"
      columns: ["job_name"]
isOneToOne: false
      referencedRelation: "job_definition"
      referencedColumns: ["name"]
    }
                  ]
                },"journal_entry": {
                  Row: {
                    "created_at": string,"created_by": string | null,"entry_date": string,"entry_number": number | null,"id": string,"kind": string,"memo": string,"organization_id": string,"posted_at": string | null,"posted_by": string | null,"reverses_entry_id": string | null,"source_id": string | null,"source_type": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"entry_date": string,"entry_number"?: number | null,"id"?: string,"kind"?: string,"memo": string,"organization_id": string,"posted_at"?: string | null,"posted_by"?: string | null,"reverses_entry_id"?: string | null,"source_id"?: string | null,"source_type"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"entry_date"?: string,"entry_number"?: number | null,"id"?: string,"kind"?: string,"memo"?: string,"organization_id"?: string,"posted_at"?: string | null,"posted_by"?: string | null,"reverses_entry_id"?: string | null,"source_id"?: string | null,"source_type"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "journal_entry_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "journal_entry_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "journal_entry_posted_by_fkey"
      columns: ["posted_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "journal_entry_reverses_entry_id_fkey"
      columns: ["reverses_entry_id"]
isOneToOne: false
      referencedRelation: "journal_entry"
      referencedColumns: ["id"]
    }
                  ]
                },"journal_line": {
                  Row: {
                    "account_id": string,"created_at": string,"credit_cents": number,"debit_cents": number,"description": string | null,"entry_id": string,"fund_id": string,"id": string,"line_no": number,"organization_id": string,"program_id": string | null,"project_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"created_at"?: string,"credit_cents"?: number,"debit_cents"?: number,"description"?: string | null,"entry_id": string,"fund_id": string,"id"?: string,"line_no": number,"organization_id": string,"program_id"?: string | null,"project_id"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"created_at"?: string,"credit_cents"?: number,"debit_cents"?: number,"description"?: string | null,"entry_id"?: string,"fund_id"?: string,"id"?: string,"line_no"?: number,"organization_id"?: string,"program_id"?: string | null,"project_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "journal_line_organization_id_account_id_fkey"
      columns: ["organization_id","account_id"]
isOneToOne: false
      referencedRelation: "ledger_account"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "journal_line_organization_id_entry_id_fkey"
      columns: ["organization_id","entry_id"]
isOneToOne: false
      referencedRelation: "journal_entry"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "journal_line_organization_id_fund_id_fkey"
      columns: ["organization_id","fund_id"]
isOneToOne: false
      referencedRelation: "ledger_fund"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "journal_line_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "journal_line_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    }
                  ]
                },"label": {
                  Row: {
                    "color": string,"id": string,"name": string,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string,"id"?: string,"name": string,"organization_id": string
                  }
                  Update: {
                    "color"?: string,"id"?: string,"name"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "label_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"ledger_account": {
                  Row: {
                    "account_type": string,"code": string,"created_at": string,"description": string | null,"id": string,"is_active": boolean,"name": string,"organization_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_type": string,"code": string,"created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string,"updated_at"?: string
                  }
                  Update: {
                    "account_type"?: string,"code"?: string,"created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_account_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"ledger_accountant_grant": {
                  Row: {
                    "created_at": string,"expires_at": string,"granted_by": string | null,"id": string,"note": string | null,"organization_id": string,"revoked_at": string | null,"revoked_by": string | null,"starts_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expires_at": string,"granted_by"?: string | null,"id"?: string,"note"?: string | null,"organization_id": string,"revoked_at"?: string | null,"revoked_by"?: string | null,"starts_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string,"granted_by"?: string | null,"id"?: string,"note"?: string | null,"organization_id"?: string,"revoked_at"?: string | null,"revoked_by"?: string | null,"starts_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_accountant_grant_granted_by_fkey"
      columns: ["granted_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_accountant_grant_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_accountant_grant_revoked_by_fkey"
      columns: ["revoked_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_accountant_grant_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"ledger_accountant_session": {
                  Row: {
                    "first_seen_at": string,"organization_id": string,"session_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "first_seen_at"?: string,"organization_id": string,"session_id": string,"user_id": string
                  }
                  Update: {
                    "first_seen_at"?: string,"organization_id"?: string,"session_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_accountant_session_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_accountant_session_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"ledger_fund": {
                  Row: {
                    "code": string,"created_at": string,"description": string | null,"ends_on": string | null,"funder": string | null,"id": string,"is_active": boolean,"name": string,"organization_id": string,"restriction": string,"starts_on": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"description"?: string | null,"ends_on"?: string | null,"funder"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string,"restriction": string,"starts_on"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"description"?: string | null,"ends_on"?: string | null,"funder"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string,"restriction"?: string,"starts_on"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_fund_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"ledger_fund_program": {
                  Row: {
                    "created_at": string,"fund_id": string,"organization_id": string,"program_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"fund_id": string,"organization_id": string,"program_id": string
                  }
                  Update: {
                    "created_at"?: string,"fund_id"?: string,"organization_id"?: string,"program_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_fund_program_organization_id_fund_id_fkey"
      columns: ["organization_id","fund_id"]
isOneToOne: false
      referencedRelation: "ledger_fund"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "ledger_fund_program_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    }
                  ]
                },"ledger_fund_release": {
                  Row: {
                    "amount_cents": number,"condition": string,"created_at": string,"entry_id": string,"from_fund_id": string,"id": string,"organization_id": string,"release_date": string,"released_by": string | null,"to_fund_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"condition": string,"created_at"?: string,"entry_id": string,"from_fund_id": string,"id"?: string,"organization_id": string,"release_date": string,"released_by"?: string | null,"to_fund_id": string
                  }
                  Update: {
                    "amount_cents"?: number,"condition"?: string,"created_at"?: string,"entry_id"?: string,"from_fund_id"?: string,"id"?: string,"organization_id"?: string,"release_date"?: string,"released_by"?: string | null,"to_fund_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_fund_release_organization_id_entry_id_fkey"
      columns: ["organization_id","entry_id"]
isOneToOne: false
      referencedRelation: "journal_entry"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "ledger_fund_release_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_fund_release_organization_id_from_fund_id_fkey"
      columns: ["organization_id","from_fund_id"]
isOneToOne: false
      referencedRelation: "ledger_fund"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "ledger_fund_release_organization_id_to_fund_id_fkey"
      columns: ["organization_id","to_fund_id"]
isOneToOne: false
      referencedRelation: "ledger_fund"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "ledger_fund_release_released_by_fkey"
      columns: ["released_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"ledger_period": {
                  Row: {
                    "closed_at": string | null,"closed_by": string | null,"created_at": string,"ends_on": string,"id": string,"name": string,"organization_id": string,"starts_on": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"closed_by"?: string | null,"created_at"?: string,"ends_on": string,"id"?: string,"name": string,"organization_id": string,"starts_on": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "closed_at"?: string | null,"closed_by"?: string | null,"created_at"?: string,"ends_on"?: string,"id"?: string,"name"?: string,"organization_id"?: string,"starts_on"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_period_closed_by_fkey"
      columns: ["closed_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_period_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"ledger_reader": {
                  Row: {
                    "created_at": string,"granted_by": string | null,"organization_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"granted_by"?: string | null,"organization_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"granted_by"?: string | null,"organization_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_reader_granted_by_fkey"
      columns: ["granted_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_reader_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_reader_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"ledger_settings": {
                  Row: {
                    "chart_approval_recorded_at": string | null,"chart_approval_recorded_by": string | null,"chart_approved_by_name": string | null,"chart_approved_on": string | null,"created_at": string,"last_entry_number": number,"organization_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "chart_approval_recorded_at"?: string | null,"chart_approval_recorded_by"?: string | null,"chart_approved_by_name"?: string | null,"chart_approved_on"?: string | null,"created_at"?: string,"last_entry_number"?: number,"organization_id": string,"updated_at"?: string
                  }
                  Update: {
                    "chart_approval_recorded_at"?: string | null,"chart_approval_recorded_by"?: string | null,"chart_approved_by_name"?: string | null,"chart_approved_on"?: string | null,"created_at"?: string,"last_entry_number"?: number,"organization_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_settings_chart_approval_recorded_by_fkey"
      columns: ["chart_approval_recorded_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_settings_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: true
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"ledger_year_close": {
                  Row: {
                    "closed_at": string,"closed_by": string | null,"closing_entry_id": string | null,"ends_on": string,"id": string,"organization_id": string,"reopen_reason": string | null,"reopened_at": string | null,"reopened_by": string | null,"reopening_entry_id": string | null,"starts_on": string
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string,"closed_by"?: string | null,"closing_entry_id"?: string | null,"ends_on": string,"id"?: string,"organization_id": string,"reopen_reason"?: string | null,"reopened_at"?: string | null,"reopened_by"?: string | null,"reopening_entry_id"?: string | null,"starts_on": string
                  }
                  Update: {
                    "closed_at"?: string,"closed_by"?: string | null,"closing_entry_id"?: string | null,"ends_on"?: string,"id"?: string,"organization_id"?: string,"reopen_reason"?: string | null,"reopened_at"?: string | null,"reopened_by"?: string | null,"reopening_entry_id"?: string | null,"starts_on"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_year_close_closed_by_fkey"
      columns: ["closed_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_year_close_closing_entry_id_fkey"
      columns: ["closing_entry_id"]
isOneToOne: false
      referencedRelation: "journal_entry"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_year_close_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_year_close_reopened_by_fkey"
      columns: ["reopened_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ledger_year_close_reopening_entry_id_fkey"
      columns: ["reopening_entry_id"]
isOneToOne: false
      referencedRelation: "journal_entry"
      referencedColumns: ["id"]
    }
                  ]
                },"legal_hold": {
                  Row: {
                    "category_key": string | null,"id": string,"organization_id": string,"placed_at": string,"placed_by": string | null,"reason": string,"record_id": string | null,"record_type": string | null,"release_reason": string | null,"released_at": string | null,"released_by": string | null,"scope": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_key"?: string | null,"id"?: string,"organization_id": string,"placed_at"?: string,"placed_by"?: string | null,"reason": string,"record_id"?: string | null,"record_type"?: string | null,"release_reason"?: string | null,"released_at"?: string | null,"released_by"?: string | null,"scope": string
                  }
                  Update: {
                    "category_key"?: string | null,"id"?: string,"organization_id"?: string,"placed_at"?: string,"placed_by"?: string | null,"reason"?: string,"record_id"?: string | null,"record_type"?: string | null,"release_reason"?: string | null,"released_at"?: string | null,"released_by"?: string | null,"scope"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "legal_hold_category_key_fkey"
      columns: ["category_key"]
isOneToOne: false
      referencedRelation: "record_category"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "legal_hold_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "legal_hold_placed_by_fkey"
      columns: ["placed_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "legal_hold_record_type_fkey"
      columns: ["record_type"]
isOneToOne: false
      referencedRelation: "retention_record_type"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "legal_hold_released_by_fkey"
      columns: ["released_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"lens": {
                  Row: {
                    "created_at": string,"id": string,"kind": string,"layout": NonNullable<Json>,"legacy_query": Json | null,"name": string,"organization_id": string,"owner_id": string,"path": string | null,"source_saved_view_id": string | null,"spec": NonNullable<Json>,"type_key": string | null,"unsupported_filters": (string)[],"updated_at": string,"visibility": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"kind": string,"layout"?: NonNullable<Json>,"legacy_query"?: Json | null,"name": string,"organization_id": string,"owner_id": string,"path"?: string | null,"source_saved_view_id"?: string | null,"spec"?: NonNullable<Json>,"type_key"?: string | null,"unsupported_filters"?: (string)[],"updated_at"?: string,"visibility"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"kind"?: string,"layout"?: NonNullable<Json>,"legacy_query"?: Json | null,"name"?: string,"organization_id"?: string,"owner_id"?: string,"path"?: string | null,"source_saved_view_id"?: string | null,"spec"?: NonNullable<Json>,"type_key"?: string | null,"unsupported_filters"?: (string)[],"updated_at"?: string,"visibility"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lens_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lens_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lens_source_saved_view_id_fkey"
      columns: ["source_saved_view_id"]
isOneToOne: true
      referencedRelation: "saved_view"
      referencedColumns: ["id"]
    }
                  ]
                },"lens_column_setting": {
                  Row: {
                    "hidden": boolean,"name_en": string | null,"name_fr": string | null,"organization_id": string,"property_key": string,"type_key": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "hidden"?: boolean,"name_en"?: string | null,"name_fr"?: string | null,"organization_id": string,"property_key": string,"type_key": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "hidden"?: boolean,"name_en"?: string | null,"name_fr"?: string | null,"organization_id"?: string,"property_key"?: string,"type_key"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lens_column_setting_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lens_column_setting_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"lens_totals_setting": {
                  Row: {
                    "choices": NonNullable<Json>,"type_key": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "choices"?: NonNullable<Json>,"type_key": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "choices"?: NonNullable<Json>,"type_key"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lens_totals_setting_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"lens_viewer_setting": {
                  Row: {
                    "layout": NonNullable<Json>,"lens_id": string,"sort": Json | null,"updated_at": string,"user_id": string,"where": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "layout"?: NonNullable<Json>,"lens_id": string,"sort"?: Json | null,"updated_at"?: string,"user_id": string,"where"?: Json | null
                  }
                  Update: {
                    "layout"?: NonNullable<Json>,"lens_id"?: string,"sort"?: Json | null,"updated_at"?: string,"user_id"?: string,"where"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lens_viewer_setting_lens_id_fkey"
      columns: ["lens_id"]
isOneToOne: false
      referencedRelation: "lens"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lens_viewer_setting_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"meeting": {
                  Row: {
                    "channel_id": string | null,"created_at": string,"crm_organization_id": string | null,"ends_at": string | null,"event_id": string | null,"id": string,"location": string | null,"meeting_link": string | null,"notes": string | null,"organization_id": string,"organizer_id": string,"program_id": string | null,"project_id": string | null,"purpose": string | null,"recurrence_rule": string | null,"series_id": string | null,"starts_at": string,"status": Database["public"]['Enums']["meeting_status"],"summary_posted_at": string | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel_id"?: string | null,"created_at"?: string,"crm_organization_id"?: string | null,"ends_at"?: string | null,"event_id"?: string | null,"id"?: string,"location"?: string | null,"meeting_link"?: string | null,"notes"?: string | null,"organization_id": string,"organizer_id": string,"program_id"?: string | null,"project_id"?: string | null,"purpose"?: string | null,"recurrence_rule"?: string | null,"series_id"?: string | null,"starts_at": string,"status"?: Database["public"]['Enums']["meeting_status"],"summary_posted_at"?: string | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "channel_id"?: string | null,"created_at"?: string,"crm_organization_id"?: string | null,"ends_at"?: string | null,"event_id"?: string | null,"id"?: string,"location"?: string | null,"meeting_link"?: string | null,"notes"?: string | null,"organization_id"?: string,"organizer_id"?: string,"program_id"?: string | null,"project_id"?: string | null,"purpose"?: string | null,"recurrence_rule"?: string | null,"series_id"?: string | null,"starts_at"?: string,"status"?: Database["public"]['Enums']["meeting_status"],"summary_posted_at"?: string | null,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "channel"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_crm_organization_id_fkey"
      columns: ["crm_organization_id"]
isOneToOne: false
      referencedRelation: "crm_organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "event"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_organizer_id_fkey"
      columns: ["organizer_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    }
                  ]
                },"meeting_action": {
                  Row: {
                    "agenda_item_id": string | null,"created_at": string,"due_at": string | null,"id": string,"meeting_id": string,"owner_id": string | null,"task_id": string | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agenda_item_id"?: string | null,"created_at"?: string,"due_at"?: string | null,"id"?: string,"meeting_id": string,"owner_id"?: string | null,"task_id"?: string | null,"title": string
                  }
                  Update: {
                    "agenda_item_id"?: string | null,"created_at"?: string,"due_at"?: string | null,"id"?: string,"meeting_id"?: string,"owner_id"?: string | null,"task_id"?: string | null,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_action_agenda_item_id_fkey"
      columns: ["agenda_item_id"]
isOneToOne: false
      referencedRelation: "agenda_item"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_action_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meeting"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_action_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_action_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "task"
      referencedColumns: ["id"]
    }
                  ]
                },"meeting_attendee": {
                  Row: {
                    "attended": boolean | null,"created_at": string,"meeting_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attended"?: boolean | null,"created_at"?: string,"meeting_id": string,"user_id": string
                  }
                  Update: {
                    "attended"?: boolean | null,"created_at"?: string,"meeting_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_attendee_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meeting"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_attendee_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"meeting_capture": {
                  Row: {
                    "agenda_item_id": string | null,"body": string,"created_at": string,"created_by": string,"created_object_id": string | null,"created_object_type": string | null,"detail": string | null,"due_on": string | null,"id": string,"kind": string,"meeting_id": string,"organization_id": string,"owner_id": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agenda_item_id"?: string | null,"body": string,"created_at"?: string,"created_by"?: string,"created_object_id"?: string | null,"created_object_type"?: string | null,"detail"?: string | null,"due_on"?: string | null,"id"?: string,"kind": string,"meeting_id": string,"organization_id": string,"owner_id"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "agenda_item_id"?: string | null,"body"?: string,"created_at"?: string,"created_by"?: string,"created_object_id"?: string | null,"created_object_type"?: string | null,"detail"?: string | null,"due_on"?: string | null,"id"?: string,"kind"?: string,"meeting_id"?: string,"organization_id"?: string,"owner_id"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_capture_agenda_item_id_fkey"
      columns: ["agenda_item_id"]
isOneToOne: false
      referencedRelation: "agenda_item"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_capture_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_capture_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meeting"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_capture_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_capture_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_capture_reviewed_by_fkey"
      columns: ["reviewed_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"message": {
                  Row: {
                    "author_id": string,"body": string,"channel_id": string | null,"conversation_id": string | null,"created_at": string,"deleted_at": string | null,"edited_at": string | null,"id": string,"is_system": boolean,"organization_id": string,"source_record_id": string | null,"source_record_type": string | null,"thread_root_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"body": string,"channel_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"edited_at"?: string | null,"id"?: string,"is_system"?: boolean,"organization_id": string,"source_record_id"?: string | null,"source_record_type"?: string | null,"thread_root_id"?: string | null
                  }
                  Update: {
                    "author_id"?: string,"body"?: string,"channel_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"edited_at"?: string | null,"id"?: string,"is_system"?: boolean,"organization_id"?: string,"source_record_id"?: string | null,"source_record_type"?: string | null,"thread_root_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "message_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "message_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "channel"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "message_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversation"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "message_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "message_thread_root_id_fkey"
      columns: ["thread_root_id"]
isOneToOne: false
      referencedRelation: "message"
      referencedColumns: ["id"]
    }
                  ]
                },"message_mention": {
                  Row: {
                    "created_at": string,"mentioned_user_id": string,"message_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"mentioned_user_id": string,"message_id": string
                  }
                  Update: {
                    "created_at"?: string,"mentioned_user_id"?: string,"message_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "message_mention_mentioned_user_id_fkey"
      columns: ["mentioned_user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "message_mention_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "message"
      referencedColumns: ["id"]
    }
                  ]
                },"message_reaction": {
                  Row: {
                    "created_at": string,"emoji": string,"message_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"emoji": string,"message_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"emoji"?: string,"message_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "message_reaction_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "message"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "message_reaction_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"milestone": {
                  Row: {
                    "completed_at": string | null,"created_at": string,"description": string | null,"due_date": string | null,"evidence": string | null,"id": string,"name": string,"owner_id": string | null,"project_id": string,"sort_key": number,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string | null,"created_at"?: string,"description"?: string | null,"due_date"?: string | null,"evidence"?: string | null,"id"?: string,"name": string,"owner_id"?: string | null,"project_id": string,"sort_key"?: number,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "completed_at"?: string | null,"created_at"?: string,"description"?: string | null,"due_date"?: string | null,"evidence"?: string | null,"id"?: string,"name"?: string,"owner_id"?: string | null,"project_id"?: string,"sort_key"?: number,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "milestone_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "milestone_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    }
                  ]
                },"milestone_dependency": {
                  Row: {
                    "blocked_milestone_id": string,"blocking_milestone_id": string,"created_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "blocked_milestone_id": string,"blocking_milestone_id": string,"created_at"?: string
                  }
                  Update: {
                    "blocked_milestone_id"?: string,"blocking_milestone_id"?: string,"created_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "milestone_dependency_blocked_milestone_id_fkey"
      columns: ["blocked_milestone_id"]
isOneToOne: false
      referencedRelation: "milestone"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "milestone_dependency_blocking_milestone_id_fkey"
      columns: ["blocking_milestone_id"]
isOneToOne: false
      referencedRelation: "milestone"
      referencedColumns: ["id"]
    }
                  ]
                },"notification": {
                  Row: {
                    "body": string | null,"category": string,"context": string | null,"created_at": string,"dedupe_key": string | null,"due_on": string | null,"id": string,"link": string | null,"organization_id": string,"owner_label": string | null,"project_id": string | null,"read_at": string | null,"reason": string | null,"source_id": string | null,"source_type": string | null,"thread_id": string | null,"title": string,"urgency": Database["public"]['Enums']["notification_urgency"],"user_id": string,"notification_reopen": undefined | null
                  }
                  ComputedFields: "notification_reopen"
                  Insert: {
                    "body"?: string | null,"category": string,"context"?: string | null,"created_at"?: string,"dedupe_key"?: string | null,"due_on"?: string | null,"id"?: string,"link"?: string | null,"organization_id": string,"owner_label"?: string | null,"project_id"?: string | null,"read_at"?: string | null,"reason"?: string | null,"source_id"?: string | null,"source_type"?: string | null,"thread_id"?: string | null,"title": string,"urgency"?: Database["public"]['Enums']["notification_urgency"],"user_id": string
                  }
                  Update: {
                    "body"?: string | null,"category"?: string,"context"?: string | null,"created_at"?: string,"dedupe_key"?: string | null,"due_on"?: string | null,"id"?: string,"link"?: string | null,"organization_id"?: string,"owner_label"?: string | null,"project_id"?: string | null,"read_at"?: string | null,"reason"?: string | null,"source_id"?: string | null,"source_type"?: string | null,"thread_id"?: string | null,"title"?: string,"urgency"?: Database["public"]['Enums']["notification_urgency"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_delivery": {
                  Row: {
                    "attempts": number,"channel": string,"created_at": string,"dedupe_key": string,"id": string,"last_error": string | null,"next_attempt_at": string | null,"notification_id": string,"provider_message_id": string | null,"sent_at": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"channel"?: string,"created_at"?: string,"dedupe_key": string,"id"?: string,"last_error"?: string | null,"next_attempt_at"?: string | null,"notification_id": string,"provider_message_id"?: string | null,"sent_at"?: string | null,"status"?: string
                  }
                  Update: {
                    "attempts"?: number,"channel"?: string,"created_at"?: string,"dedupe_key"?: string,"id"?: string,"last_error"?: string | null,"next_attempt_at"?: string | null,"notification_id"?: string,"provider_message_id"?: string | null,"sent_at"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_delivery_notification_id_fkey"
      columns: ["notification_id"]
isOneToOne: false
      referencedRelation: "notification"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_preference": {
                  Row: {
                    "category_modes": NonNullable<Json>,"delivery_mode": string,"digest_hour": number,"digest_weekday": number,"email_announcements": boolean,"email_assignments": boolean,"email_critical": boolean,"email_digest": boolean,"email_due_dates": boolean,"email_mentions": boolean,"hub_muted_categories": (string)[],"muted_project_ids": (string)[],"muted_thread_ids": (string)[],"quiet_hours_end": number | null,"quiet_hours_start": number | null,"timezone": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_modes"?: NonNullable<Json>,"delivery_mode"?: string,"digest_hour"?: number,"digest_weekday"?: number,"email_announcements"?: boolean,"email_assignments"?: boolean,"email_critical"?: boolean,"email_digest"?: boolean,"email_due_dates"?: boolean,"email_mentions"?: boolean,"hub_muted_categories"?: (string)[],"muted_project_ids"?: (string)[],"muted_thread_ids"?: (string)[],"quiet_hours_end"?: number | null,"quiet_hours_start"?: number | null,"timezone"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "category_modes"?: NonNullable<Json>,"delivery_mode"?: string,"digest_hour"?: number,"digest_weekday"?: number,"email_announcements"?: boolean,"email_assignments"?: boolean,"email_critical"?: boolean,"email_digest"?: boolean,"email_due_dates"?: boolean,"email_mentions"?: boolean,"hub_muted_categories"?: (string)[],"muted_project_ids"?: (string)[],"muted_thread_ids"?: (string)[],"quiet_hours_end"?: number | null,"quiet_hours_start"?: number | null,"timezone"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_preference_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"object": {
                  Row: {
                    "archived_at": string | null,"cover": string | null,"created_at": string,"created_by": string | null,"deleted_at": string | null,"icon": string | null,"id": string,"organization_id": string,"owner_id": string | null,"parent_object_id": string | null,"search_vector": unknown,"space_id": string | null,"title": string,"type_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"cover"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"icon"?: string | null,"id"?: string,"organization_id": string,"owner_id"?: string | null,"parent_object_id"?: string | null,"search_vector"?: never,"space_id"?: string | null,"title"?: string,"type_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "archived_at"?: string | null,"cover"?: string | null,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"icon"?: string | null,"id"?: string,"organization_id"?: string,"owner_id"?: string | null,"parent_object_id"?: string | null,"search_vector"?: never,"space_id"?: string | null,"title"?: string,"type_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "object_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "object_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "object_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "object_parent_object_id_fkey"
      columns: ["parent_object_id"]
isOneToOne: false
      referencedRelation: "object"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "object_type_id_organization_id_fkey"
      columns: ["type_id","organization_id"]
isOneToOne: false
      referencedRelation: "object_type"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "object_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"object_approval": {
                  Row: {
                    "approval_item_id": string,"created_at": string,"id": string,"object_id": string,"object_type": string,"organization_id": string,"requested_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approval_item_id": string,"created_at"?: string,"id"?: string,"object_id": string,"object_type": string,"organization_id": string,"requested_by": string
                  }
                  Update: {
                    "approval_item_id"?: string,"created_at"?: string,"id"?: string,"object_id"?: string,"object_type"?: string,"organization_id"?: string,"requested_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "object_approval_approval_item_id_fkey"
      columns: ["approval_item_id"]
isOneToOne: true
      referencedRelation: "approval_item"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "object_approval_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "object_approval_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"object_event": {
                  Row: {
                    "actor_id": string | null,"actor_kind": string,"change_set_id": string | null,"changes": NonNullable<Json>,"id": string,"object_id": string,"object_type": string,"occurred_at": string,"organization_id": string,"program_id": string | null,"project_id": string | null,"seq": number,"verb": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"actor_kind": string,"change_set_id"?: string | null,"changes"?: NonNullable<Json>,"id"?: string,"object_id": string,"object_type": string,"occurred_at"?: string,"organization_id": string,"program_id"?: string | null,"project_id"?: string | null,"seq"?: never,"verb": string
                  }
                  Update: {
                    "actor_id"?: string | null,"actor_kind"?: string,"change_set_id"?: string | null,"changes"?: NonNullable<Json>,"id"?: string,"object_id"?: string,"object_type"?: string,"occurred_at"?: string,"organization_id"?: string,"program_id"?: string | null,"project_id"?: string | null,"seq"?: never,"verb"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "object_event_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"object_event_cursor": {
                  Row: {
                    "consumer": string,"last_seq": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "consumer": string,"last_seq"?: number,"updated_at"?: string
                  }
                  Update: {
                    "consumer"?: string,"last_seq"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"object_layout": {
                  Row: {
                    "created_at": string,"id": string,"layout": NonNullable<Json>,"organization_id": string,"type_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"layout": NonNullable<Json>,"organization_id": string,"type_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"layout"?: NonNullable<Json>,"organization_id"?: string,"type_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "object_layout_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "object_layout_type_id_organization_id_fkey"
      columns: ["type_id","organization_id"]
isOneToOne: false
      referencedRelation: "object_type"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "object_layout_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"object_lock": {
                  Row: {
                    "locked_at": string,"locked_by": string | null,"object_id": string,"organization_id": string,"reason": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "locked_at"?: string,"locked_by"?: string | null,"object_id": string,"organization_id": string,"reason"?: string | null
                  }
                  Update: {
                    "locked_at"?: string,"locked_by"?: string | null,"object_id"?: string,"organization_id"?: string,"reason"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "object_lock_locked_by_fkey"
      columns: ["locked_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "object_lock_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"object_presence": {
                  Row: {
                    "cursor": Json | null,"editing": boolean,"object_id": string,"organization_id": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cursor"?: Json | null,"editing"?: boolean,"object_id": string,"organization_id": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "cursor"?: Json | null,"editing"?: boolean,"object_id"?: string,"organization_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "object_presence_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "object_presence_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"object_relation": {
                  Row: {
                    "created_at": string,"created_by": string | null,"from_id": string,"id": string,"organization_id": string,"position": number | null,"relation_type_id": string,"to_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"from_id": string,"id"?: string,"organization_id": string,"position"?: number | null,"relation_type_id": string,"to_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"from_id"?: string,"id"?: string,"organization_id"?: string,"position"?: number | null,"relation_type_id"?: string,"to_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "object_relation_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "object_relation_from_id_fkey"
      columns: ["from_id"]
isOneToOne: false
      referencedRelation: "object"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "object_relation_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "object_relation_relation_type_id_organization_id_fkey"
      columns: ["relation_type_id","organization_id"]
isOneToOne: false
      referencedRelation: "relation_type"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "object_relation_to_id_fkey"
      columns: ["to_id"]
isOneToOne: false
      referencedRelation: "object"
      referencedColumns: ["id"]
    }
                  ]
                },"object_suggestion": {
                  Row: {
                    "author_id": string,"block_id": string,"created_at": string,"decided_at": string | null,"decided_by": string | null,"end_offset": number,"id": string,"object_id": string,"object_type": string,"organization_id": string,"original_text": string,"proposed_text": string,"start_offset": number,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string,"block_id": string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"end_offset": number,"id"?: string,"object_id": string,"object_type": string,"organization_id": string,"original_text": string,"proposed_text": string,"start_offset": number,"status"?: string
                  }
                  Update: {
                    "author_id"?: string,"block_id"?: string,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"end_offset"?: number,"id"?: string,"object_id"?: string,"object_type"?: string,"organization_id"?: string,"original_text"?: string,"proposed_text"?: string,"start_offset"?: number,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "object_suggestion_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "object_suggestion_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "object_suggestion_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"object_trash": {
                  Row: {
                    "deleted_at": string,"deleted_by": string | null,"id": string,"object_id": string,"object_type": string,"organization_id": string,"purge_after": string,"purged_at": string | null,"restored_at": string | null,"restored_by": string | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "deleted_at"?: string,"deleted_by"?: string | null,"id"?: string,"object_id": string,"object_type": string,"organization_id": string,"purge_after": string,"purged_at"?: string | null,"restored_at"?: string | null,"restored_by"?: string | null,"title": string
                  }
                  Update: {
                    "deleted_at"?: string,"deleted_by"?: string | null,"id"?: string,"object_id"?: string,"object_type"?: string,"organization_id"?: string,"purge_after"?: string,"purged_at"?: string | null,"restored_at"?: string | null,"restored_by"?: string | null,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "object_trash_deleted_by_fkey"
      columns: ["deleted_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "object_trash_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "object_trash_restored_by_fkey"
      columns: ["restored_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"object_type": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"default_lens": string,"default_template_id": string | null,"icon": string | null,"id": string,"key": string,"kind": string,"name_en": string,"name_fr": string,"native_table": string | null,"organization_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"default_lens"?: string,"default_template_id"?: string | null,"icon"?: string | null,"id"?: string,"key": string,"kind": string,"name_en": string,"name_fr": string,"native_table"?: string | null,"organization_id": string,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"default_lens"?: string,"default_template_id"?: string | null,"icon"?: string | null,"id"?: string,"key"?: string,"kind"?: string,"name_en"?: string,"name_fr"?: string,"native_table"?: string | null,"organization_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "object_type_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"object_version": {
                  Row: {
                    "content": NonNullable<Json>,"content_hash": string,"created_at": string,"created_by": string | null,"id": string,"kind": string,"label": string | null,"object_id": string,"object_type": string,"organization_id": string,"properties": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "content"?: NonNullable<Json>,"content_hash": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind": string,"label"?: string | null,"object_id": string,"object_type": string,"organization_id": string,"properties"?: NonNullable<Json>
                  }
                  Update: {
                    "content"?: NonNullable<Json>,"content_hash"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind"?: string,"label"?: string | null,"object_id"?: string,"object_type"?: string,"organization_id"?: string,"properties"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "object_version_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "object_version_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"operator_switch": {
                  Row: {
                    "changed_at": string | null,"changed_by": string | null,"changed_via": string | null,"enabled": boolean,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "changed_at"?: string | null,"changed_by"?: string | null,"changed_via"?: string | null,"enabled"?: boolean,"name": string
                  }
                  Update: {
                    "changed_at"?: string | null,"changed_by"?: string | null,"changed_via"?: string | null,"enabled"?: boolean,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"opportunity": {
                  Row: {
                    "amount_awarded": number | null,"amount_requested": number | null,"contact_id": string | null,"created_at": string,"created_by": string | null,"crm_organization_id": string,"currency": string,"decided_at": string | null,"decision_expected_at": string | null,"description": string | null,"id": string,"is_open": boolean | null,"kind": Database["public"]['Enums']["opportunity_kind"],"organization_id": string,"outcome_note": string | null,"owner_id": string,"program_id": string | null,"project_id": string | null,"stage": Database["public"]['Enums']["opportunity_stage"],"submitted_at": string | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_awarded"?: number | null,"amount_requested"?: number | null,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"crm_organization_id": string,"currency"?: string,"decided_at"?: string | null,"decision_expected_at"?: string | null,"description"?: string | null,"id"?: string,"is_open"?: never,"kind"?: Database["public"]['Enums']["opportunity_kind"],"organization_id": string,"outcome_note"?: string | null,"owner_id": string,"program_id"?: string | null,"project_id"?: string | null,"stage"?: Database["public"]['Enums']["opportunity_stage"],"submitted_at"?: string | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_awarded"?: number | null,"amount_requested"?: number | null,"contact_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"crm_organization_id"?: string,"currency"?: string,"decided_at"?: string | null,"decision_expected_at"?: string | null,"description"?: string | null,"id"?: string,"is_open"?: never,"kind"?: Database["public"]['Enums']["opportunity_kind"],"organization_id"?: string,"outcome_note"?: string | null,"owner_id"?: string,"program_id"?: string | null,"project_id"?: string | null,"stage"?: Database["public"]['Enums']["opportunity_stage"],"submitted_at"?: string | null,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "opportunity_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "crm_contact"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opportunity_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opportunity_crm_organization_id_fkey"
      columns: ["crm_organization_id"]
isOneToOne: false
      referencedRelation: "crm_organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opportunity_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opportunity_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opportunity_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opportunity_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    }
                  ]
                },"organization": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"slug": string,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"slug": string,"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"slug"?: string,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"organization_membership": {
                  Row: {
                    "created_at": string,"deactivated_at": string | null,"id": string,"joined_at": string,"organization_id": string,"role": Database["public"]['Enums']["org_role"],"status": Database["public"]['Enums']["membership_status"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"deactivated_at"?: string | null,"id"?: string,"joined_at"?: string,"organization_id": string,"role"?: Database["public"]['Enums']["org_role"],"status"?: Database["public"]['Enums']["membership_status"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"deactivated_at"?: string | null,"id"?: string,"joined_at"?: string,"organization_id"?: string,"role"?: Database["public"]['Enums']["org_role"],"status"?: Database["public"]['Enums']["membership_status"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_membership_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_membership_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"outcome_measurement": {
                  Row: {
                    "created_at": string,"id": string,"measured_on": string,"metric_id": string,"note": string | null,"organization_id": string,"recorded_by": string | null,"sample_size": number | null,"source": string | null,"value": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"measured_on": string,"metric_id": string,"note"?: string | null,"organization_id": string,"recorded_by"?: string | null,"sample_size"?: number | null,"source"?: string | null,"value": number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"measured_on"?: string,"metric_id"?: string,"note"?: string | null,"organization_id"?: string,"recorded_by"?: string | null,"sample_size"?: number | null,"source"?: string | null,"value"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "outcome_measurement_metric_id_fkey"
      columns: ["metric_id"]
isOneToOne: false
      referencedRelation: "outcome_metric"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "outcome_measurement_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "outcome_measurement_recorded_by_fkey"
      columns: ["recorded_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"outcome_metric": {
                  Row: {
                    "baseline": number | null,"baseline_on": string | null,"created_at": string,"created_by": string | null,"description": string | null,"direction": Database["public"]['Enums']["metric_direction"],"id": string,"name": string,"organization_id": string,"owner_id": string | null,"program_id": string,"retired_at": string | null,"target": number | null,"target_on": string | null,"unit": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "baseline"?: number | null,"baseline_on"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"direction"?: Database["public"]['Enums']["metric_direction"],"id"?: string,"name": string,"organization_id": string,"owner_id"?: string | null,"program_id": string,"retired_at"?: string | null,"target"?: number | null,"target_on"?: string | null,"unit"?: string,"updated_at"?: string
                  }
                  Update: {
                    "baseline"?: number | null,"baseline_on"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"direction"?: Database["public"]['Enums']["metric_direction"],"id"?: string,"name"?: string,"organization_id"?: string,"owner_id"?: string | null,"program_id"?: string,"retired_at"?: string | null,"target"?: number | null,"target_on"?: string | null,"unit"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "outcome_metric_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "outcome_metric_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "outcome_metric_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "outcome_metric_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    }
                  ]
                },"page": {
                  Row: {
                    "archived_at": string | null,"cover": string | null,"created_at": string,"created_by": string,"deleted_at": string | null,"icon": string | null,"id": string,"organization_id": string,"parent_page_id": string | null,"position": number,"space_id": string | null,"title": string,"updated_at": string,"updated_by": string | null,"visibility": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"cover"?: string | null,"created_at"?: string,"created_by"?: string,"deleted_at"?: string | null,"icon"?: string | null,"id"?: string,"organization_id": string,"parent_page_id"?: string | null,"position"?: number,"space_id"?: string | null,"title"?: string,"updated_at"?: string,"updated_by"?: string | null,"visibility"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"cover"?: string | null,"created_at"?: string,"created_by"?: string,"deleted_at"?: string | null,"icon"?: string | null,"id"?: string,"organization_id"?: string,"parent_page_id"?: string | null,"position"?: number,"space_id"?: string | null,"title"?: string,"updated_at"?: string,"updated_by"?: string | null,"visibility"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "page_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "page_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "page_parent_page_id_fkey"
      columns: ["parent_page_id"]
isOneToOne: false
      referencedRelation: "page"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "page_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"page_favourite": {
                  Row: {
                    "created_at": string,"page_id": string,"position": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"page_id": string,"position"?: number,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"page_id"?: string,"position"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "page_favourite_page_id_fkey"
      columns: ["page_id"]
isOneToOne: false
      referencedRelation: "page"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "page_favourite_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"page_presence": {
                  Row: {
                    "editing": boolean,"organization_id": string,"page_id": string,"tab_id": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "editing"?: boolean,"organization_id": string,"page_id": string,"tab_id": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "editing"?: boolean,"organization_id"?: string,"page_id"?: string,"tab_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "page_presence_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "page_presence_page_id_fkey"
      columns: ["page_id"]
isOneToOne: false
      referencedRelation: "page"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "page_presence_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"page_template_origin": {
                  Row: {
                    "created_at": string,"created_by": string | null,"organization_id": string,"page_id": string,"project_id": string | null,"template_id": string | null,"template_name_en": string,"template_name_fr": string,"template_version": number,"version_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"organization_id": string,"page_id": string,"project_id"?: string | null,"template_id"?: string | null,"template_name_en": string,"template_name_fr": string,"template_version": number,"version_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"organization_id"?: string,"page_id"?: string,"project_id"?: string | null,"template_id"?: string | null,"template_name_en"?: string,"template_name_fr"?: string,"template_version"?: number,"version_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "page_template_origin_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "page_template_origin_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "page_template_origin_page_id_fkey"
      columns: ["page_id"]
isOneToOne: true
      referencedRelation: "page"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "page_template_origin_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "page_template_origin_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "template_v2"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "page_template_origin_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "template_v2_version"
      referencedColumns: ["id"]
    }
                  ]
                },"page_visit": {
                  Row: {
                    "page_id": string,"user_id": string,"visited_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "page_id": string,"user_id"?: string,"visited_at"?: string
                  }
                  Update: {
                    "page_id"?: string,"user_id"?: string,"visited_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "page_visit_page_id_fkey"
      columns: ["page_id"]
isOneToOne: false
      referencedRelation: "page"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "page_visit_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"page_watch": {
                  Row: {
                    "created_at": string,"organization_id": string,"page_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"organization_id": string,"page_id": string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"organization_id"?: string,"page_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "page_watch_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "page_watch_page_id_fkey"
      columns: ["page_id"]
isOneToOne: false
      referencedRelation: "page"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "page_watch_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"payroll_account_map": {
                  Row: {
                    "category": string,"created_at": string,"credit_account_id": string | null,"debit_account_id": string | null,"organization_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "category": string,"created_at"?: string,"credit_account_id"?: string | null,"debit_account_id"?: string | null,"organization_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "category"?: string,"created_at"?: string,"credit_account_id"?: string | null,"debit_account_id"?: string | null,"organization_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payroll_account_map_organization_id_credit_account_id_fkey"
      columns: ["organization_id","credit_account_id"]
isOneToOne: false
      referencedRelation: "ledger_account"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "payroll_account_map_organization_id_debit_account_id_fkey"
      columns: ["organization_id","debit_account_id"]
isOneToOne: false
      referencedRelation: "ledger_account"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "payroll_account_map_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payroll_account_map_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"payroll_run": {
                  Row: {
                    "created_at": string,"created_by": string | null,"ee_ei_cents": number,"ee_federal_tax_cents": number,"ee_other_cents": number,"ee_qpip_cents": number,"ee_qpp_cents": number,"ee_quebec_tax_cents": number,"er_cnesst_cents": number,"er_cnt_cents": number,"er_ei_cents": number,"er_fss_cents": number,"er_other_cents": number,"er_qpip_cents": number,"er_qpp_cents": number,"file_name": string | null,"file_sha256": string | null,"fingerprint": string,"gross_wages_cents": number,"id": string,"journal_entry_id": string | null,"net_pay_cents": number,"organization_id": string,"pay_date": string,"period_end": string,"period_start": string,"posted_at": string | null,"posted_by": string | null,"provider": string,"reversal_entry_id": string | null,"reversed_at": string | null,"reversed_by": string | null,"run_reference": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"ee_ei_cents"?: number,"ee_federal_tax_cents"?: number,"ee_other_cents"?: number,"ee_qpip_cents"?: number,"ee_qpp_cents"?: number,"ee_quebec_tax_cents"?: number,"er_cnesst_cents"?: number,"er_cnt_cents"?: number,"er_ei_cents"?: number,"er_fss_cents"?: number,"er_other_cents"?: number,"er_qpip_cents"?: number,"er_qpp_cents"?: number,"file_name"?: string | null,"file_sha256"?: string | null,"fingerprint": string,"gross_wages_cents"?: number,"id"?: string,"journal_entry_id"?: string | null,"net_pay_cents"?: number,"organization_id": string,"pay_date": string,"period_end": string,"period_start": string,"posted_at"?: string | null,"posted_by"?: string | null,"provider": string,"reversal_entry_id"?: string | null,"reversed_at"?: string | null,"reversed_by"?: string | null,"run_reference"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"ee_ei_cents"?: number,"ee_federal_tax_cents"?: number,"ee_other_cents"?: number,"ee_qpip_cents"?: number,"ee_qpp_cents"?: number,"ee_quebec_tax_cents"?: number,"er_cnesst_cents"?: number,"er_cnt_cents"?: number,"er_ei_cents"?: number,"er_fss_cents"?: number,"er_other_cents"?: number,"er_qpip_cents"?: number,"er_qpp_cents"?: number,"file_name"?: string | null,"file_sha256"?: string | null,"fingerprint"?: string,"gross_wages_cents"?: number,"id"?: string,"journal_entry_id"?: string | null,"net_pay_cents"?: number,"organization_id"?: string,"pay_date"?: string,"period_end"?: string,"period_start"?: string,"posted_at"?: string | null,"posted_by"?: string | null,"provider"?: string,"reversal_entry_id"?: string | null,"reversed_at"?: string | null,"reversed_by"?: string | null,"run_reference"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payroll_run_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payroll_run_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payroll_run_organization_id_journal_entry_id_fkey"
      columns: ["organization_id","journal_entry_id"]
isOneToOne: false
      referencedRelation: "journal_entry"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "payroll_run_organization_id_reversal_entry_id_fkey"
      columns: ["organization_id","reversal_entry_id"]
isOneToOne: false
      referencedRelation: "journal_entry"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "payroll_run_posted_by_fkey"
      columns: ["posted_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payroll_run_reversed_by_fkey"
      columns: ["reversed_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"payroll_run_allocation": {
                  Row: {
                    "created_at": string,"fund_id": string,"id": string,"organization_id": string,"program_id": string | null,"run_id": string,"share_basis_points": number | null,"share_cents": number | null,"share_no": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"fund_id": string,"id"?: string,"organization_id": string,"program_id"?: string | null,"run_id": string,"share_basis_points"?: number | null,"share_cents"?: number | null,"share_no": number
                  }
                  Update: {
                    "created_at"?: string,"fund_id"?: string,"id"?: string,"organization_id"?: string,"program_id"?: string | null,"run_id"?: string,"share_basis_points"?: number | null,"share_cents"?: number | null,"share_no"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "payroll_run_allocation_organization_id_fund_id_fkey"
      columns: ["organization_id","fund_id"]
isOneToOne: false
      referencedRelation: "ledger_fund"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "payroll_run_allocation_organization_id_run_id_fkey"
      columns: ["organization_id","run_id"]
isOneToOne: false
      referencedRelation: "payroll_run"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "payroll_run_allocation_program_id_organization_id_fkey"
      columns: ["program_id","organization_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"pinned_resource": {
                  Row: {
                    "channel_id": string,"created_at": string,"id": string,"message_id": string | null,"pinned_by": string | null,"title": string,"url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "channel_id": string,"created_at"?: string,"id"?: string,"message_id"?: string | null,"pinned_by"?: string | null,"title": string,"url"?: string | null
                  }
                  Update: {
                    "channel_id"?: string,"created_at"?: string,"id"?: string,"message_id"?: string | null,"pinned_by"?: string | null,"title"?: string,"url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "pinned_resource_channel_id_fkey"
      columns: ["channel_id"]
isOneToOne: false
      referencedRelation: "channel"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pinned_resource_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "message"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pinned_resource_pinned_by_fkey"
      columns: ["pinned_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"privacy_notice_acknowledgement": {
                  Row: {
                    "acknowledged_at": string,"notice_version": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "acknowledged_at"?: string,"notice_version": string,"user_id": string
                  }
                  Update: {
                    "acknowledged_at"?: string,"notice_version"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "privacy_notice_acknowledgement_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"program": {
                  Row: {
                    "archived_at": string | null,"color": string,"created_at": string,"created_by": string | null,"description": string | null,"id": string,"important_links": NonNullable<Json>,"lead_id": string | null,"name": string,"organization_id": string,"slug": string,"status": Database["public"]['Enums']["program_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"color"?: string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"important_links"?: NonNullable<Json>,"lead_id"?: string | null,"name": string,"organization_id": string,"slug": string,"status"?: Database["public"]['Enums']["program_status"],"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"color"?: string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"important_links"?: NonNullable<Json>,"lead_id"?: string | null,"name"?: string,"organization_id"?: string,"slug"?: string,"status"?: Database["public"]['Enums']["program_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "program_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "program_lead_id_fkey"
      columns: ["lead_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "program_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"program_access_grant": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"legacy_role": string | null,"organization_id": string,"program_id": string,"role": Database["public"]['Enums']["program_access_role"],"source": Database["public"]['Enums']["scoped_grant_source"],"source_team_id": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"legacy_role"?: string | null,"organization_id": string,"program_id": string,"role": Database["public"]['Enums']["program_access_role"],"source": Database["public"]['Enums']["scoped_grant_source"],"source_team_id"?: string | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"legacy_role"?: string | null,"organization_id"?: string,"program_id"?: string,"role"?: Database["public"]['Enums']["program_access_role"],"source"?: Database["public"]['Enums']["scoped_grant_source"],"source_team_id"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "program_access_grant_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "program_access_grant_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "program_access_grant_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "program_access_grant_program_org_fk"
      columns: ["program_id","organization_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "program_access_grant_source_team_id_fkey"
      columns: ["source_team_id"]
isOneToOne: false
      referencedRelation: "team"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "program_access_grant_target_membership_fk"
      columns: ["organization_id","user_id"]
isOneToOne: false
      referencedRelation: "organization_membership"
      referencedColumns: ["organization_id","user_id"]
    },{
      foreignKeyName: "program_access_grant_team_member_fk"
      columns: ["source_team_id","user_id"]
isOneToOne: false
      referencedRelation: "team_member"
      referencedColumns: ["team_id","user_id"]
    },{
      foreignKeyName: "program_access_grant_team_org_fk"
      columns: ["source_team_id","organization_id"]
isOneToOne: false
      referencedRelation: "team"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "program_access_grant_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"program_membership": {
                  Row: {
                    "created_at": string,"program_id": string,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"program_id": string,"role"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"program_id"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "program_membership_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "program_membership_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"program_operation": {
                  Row: {
                    "attendee_count": number | null,"cancellation_reason": string | null,"contact_hours": number | null,"created_at": string,"created_by": string | null,"duration_hours": number | null,"id": string,"led_by": string | null,"location": string | null,"notes": string | null,"occurred_on": string,"organization_id": string,"program_id": string,"project_id": string | null,"staff_hours": number | null,"status": Database["public"]['Enums']["operation_status"],"title": string,"updated_at": string,"volunteer_count": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attendee_count"?: number | null,"cancellation_reason"?: string | null,"contact_hours"?: never,"created_at"?: string,"created_by"?: string | null,"duration_hours"?: number | null,"id"?: string,"led_by"?: string | null,"location"?: string | null,"notes"?: string | null,"occurred_on": string,"organization_id": string,"program_id": string,"project_id"?: string | null,"staff_hours"?: number | null,"status"?: Database["public"]['Enums']["operation_status"],"title": string,"updated_at"?: string,"volunteer_count"?: number | null
                  }
                  Update: {
                    "attendee_count"?: number | null,"cancellation_reason"?: string | null,"contact_hours"?: never,"created_at"?: string,"created_by"?: string | null,"duration_hours"?: number | null,"id"?: string,"led_by"?: string | null,"location"?: string | null,"notes"?: string | null,"occurred_on"?: string,"organization_id"?: string,"program_id"?: string,"project_id"?: string | null,"staff_hours"?: number | null,"status"?: Database["public"]['Enums']["operation_status"],"title"?: string,"updated_at"?: string,"volunteer_count"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "program_operation_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "program_operation_led_by_fkey"
      columns: ["led_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "program_operation_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "program_operation_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "program_operation_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    }
                  ]
                },"program_team_assignment": {
                  Row: {
                    "created_at": string,"created_by": string | null,"organization_id": string,"program_id": string,"role": Database["public"]['Enums']["program_access_role"],"team_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"organization_id": string,"program_id": string,"role"?: Database["public"]['Enums']["program_access_role"],"team_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"organization_id"?: string,"program_id"?: string,"role"?: Database["public"]['Enums']["program_access_role"],"team_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "program_team_assignment_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "program_team_assignment_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "program_team_assignment_program_org_fk"
      columns: ["program_id","organization_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "program_team_assignment_team_org_fk"
      columns: ["team_id","organization_id"]
isOneToOne: false
      referencedRelation: "team"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"program_template": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"color": string,"created_at": string,"created_by": string | null,"description": string | null,"id": string,"name": string,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"color"?: string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"name": string,"organization_id": string
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"color"?: string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"name"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "program_template_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "program_template_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "program_template_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"program_template_project": {
                  Row: {
                    "created_at": string,"id": string,"program_template_id": string,"project_template_id": string,"sort_key": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"program_template_id": string,"project_template_id": string,"sort_key"?: number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"program_template_id"?: string,"project_template_id"?: string,"sort_key"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "program_template_project_program_template_id_fkey"
      columns: ["program_template_id"]
isOneToOne: false
      referencedRelation: "program_template"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "program_template_project_project_template_id_fkey"
      columns: ["project_template_id"]
isOneToOne: false
      referencedRelation: "project_template"
      referencedColumns: ["id"]
    }
                  ]
                },"project": {
                  Row: {
                    "archived_at": string | null,"completed_at": string | null,"created_at": string,"created_by": string | null,"description": string | null,"funding_source_id": string | null,"health": Database["public"]['Enums']["project_health"],"health_reason": string | null,"id": string,"last_status_update_at": string | null,"name": string,"organization_id": string,"outcome": string | null,"owner_id": string | null,"priority": Database["public"]['Enums']["task_priority"],"program_id": string | null,"reporting_cadence": string,"sponsor_id": string | null,"stage": Database["public"]['Enums']["project_stage"],"start_date": string | null,"target_date": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"funding_source_id"?: string | null,"health"?: Database["public"]['Enums']["project_health"],"health_reason"?: string | null,"id"?: string,"last_status_update_at"?: string | null,"name": string,"organization_id": string,"outcome"?: string | null,"owner_id"?: string | null,"priority"?: Database["public"]['Enums']["task_priority"],"program_id"?: string | null,"reporting_cadence"?: string,"sponsor_id"?: string | null,"stage"?: Database["public"]['Enums']["project_stage"],"start_date"?: string | null,"target_date"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"funding_source_id"?: string | null,"health"?: Database["public"]['Enums']["project_health"],"health_reason"?: string | null,"id"?: string,"last_status_update_at"?: string | null,"name"?: string,"organization_id"?: string,"outcome"?: string | null,"owner_id"?: string | null,"priority"?: Database["public"]['Enums']["task_priority"],"program_id"?: string | null,"reporting_cadence"?: string,"sponsor_id"?: string | null,"stage"?: Database["public"]['Enums']["project_stage"],"start_date"?: string | null,"target_date"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_funding_source_id_fkey"
      columns: ["funding_source_id"]
isOneToOne: false
      referencedRelation: "crm_organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_sponsor_id_fkey"
      columns: ["sponsor_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"project_access_grant": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"legacy_role": string | null,"organization_id": string,"project_id": string,"role": Database["public"]['Enums']["project_access_role"],"source": Database["public"]['Enums']["scoped_grant_source"],"source_program_grant_id": string | null,"source_team_id": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"legacy_role"?: string | null,"organization_id": string,"project_id": string,"role": Database["public"]['Enums']["project_access_role"],"source": Database["public"]['Enums']["scoped_grant_source"],"source_program_grant_id"?: string | null,"source_team_id"?: string | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"legacy_role"?: string | null,"organization_id"?: string,"project_id"?: string,"role"?: Database["public"]['Enums']["project_access_role"],"source"?: Database["public"]['Enums']["scoped_grant_source"],"source_program_grant_id"?: string | null,"source_team_id"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_access_grant_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_access_grant_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_access_grant_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_access_grant_project_org_fk"
      columns: ["project_id","organization_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "project_access_grant_source_program_grant_id_fkey"
      columns: ["source_program_grant_id"]
isOneToOne: false
      referencedRelation: "program_access_grant"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_access_grant_source_team_id_fkey"
      columns: ["source_team_id"]
isOneToOne: false
      referencedRelation: "team"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_access_grant_target_membership_fk"
      columns: ["organization_id","user_id"]
isOneToOne: false
      referencedRelation: "organization_membership"
      referencedColumns: ["organization_id","user_id"]
    },{
      foreignKeyName: "project_access_grant_team_member_fk"
      columns: ["source_team_id","user_id"]
isOneToOne: false
      referencedRelation: "team_member"
      referencedColumns: ["team_id","user_id"]
    },{
      foreignKeyName: "project_access_grant_team_org_fk"
      columns: ["source_team_id","organization_id"]
isOneToOne: false
      referencedRelation: "team"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "project_access_grant_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"project_closure": {
                  Row: {
                    "closed_at": string,"closed_by": string,"evidence_links": NonNullable<Json>,"id": string,"lessons": string | null,"organization_id": string,"project_id": string,"results": string
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string,"closed_by": string,"evidence_links"?: NonNullable<Json>,"id"?: string,"lessons"?: string | null,"organization_id": string,"project_id": string,"results": string
                  }
                  Update: {
                    "closed_at"?: string,"closed_by"?: string,"evidence_links"?: NonNullable<Json>,"id"?: string,"lessons"?: string | null,"organization_id"?: string,"project_id"?: string,"results"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_closure_closed_by_fkey"
      columns: ["closed_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_closure_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_closure_project_id_fkey"
      columns: ["project_id"]
isOneToOne: true
      referencedRelation: "project"
      referencedColumns: ["id"]
    }
                  ]
                },"project_closure_document": {
                  Row: {
                    "closure_id": string,"document_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "closure_id": string,"document_id": string
                  }
                  Update: {
                    "closure_id"?: string,"document_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_closure_document_closure_id_fkey"
      columns: ["closure_id"]
isOneToOne: false
      referencedRelation: "project_closure"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_closure_document_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "document"
      referencedColumns: ["id"]
    }
                  ]
                },"project_membership": {
                  Row: {
                    "created_at": string,"project_id": string,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"project_id": string,"role"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"project_id"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_membership_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_membership_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"project_request": {
                  Row: {
                    "beneficiaries": string | null,"created_at": string,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"estimated_effort": string | null,"id": string,"needed_by": string | null,"organization_id": string,"program_id": string | null,"project_id": string | null,"rationale": string | null,"requested_by": string,"sponsor_id": string | null,"status": Database["public"]['Enums']["project_request_status"],"summary": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "beneficiaries"?: string | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"estimated_effort"?: string | null,"id"?: string,"needed_by"?: string | null,"organization_id": string,"program_id"?: string | null,"project_id"?: string | null,"rationale"?: string | null,"requested_by": string,"sponsor_id"?: string | null,"status"?: Database["public"]['Enums']["project_request_status"],"summary": string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "beneficiaries"?: string | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"estimated_effort"?: string | null,"id"?: string,"needed_by"?: string | null,"organization_id"?: string,"program_id"?: string | null,"project_id"?: string | null,"rationale"?: string | null,"requested_by"?: string,"sponsor_id"?: string | null,"status"?: Database["public"]['Enums']["project_request_status"],"summary"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_request_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_request_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_request_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_request_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_request_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_request_sponsor_id_fkey"
      columns: ["sponsor_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"project_status_update": {
                  Row: {
                    "author_id": string,"blockers": string | null,"created_at": string,"decisions_needed": string | null,"health": Database["public"]['Enums']["project_health"],"help_requested": string | null,"id": string,"next_steps": string | null,"progress_summary": string,"project_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"blockers"?: string | null,"created_at"?: string,"decisions_needed"?: string | null,"health": Database["public"]['Enums']["project_health"],"help_requested"?: string | null,"id"?: string,"next_steps"?: string | null,"progress_summary": string,"project_id": string
                  }
                  Update: {
                    "author_id"?: string,"blockers"?: string | null,"created_at"?: string,"decisions_needed"?: string | null,"health"?: Database["public"]['Enums']["project_health"],"help_requested"?: string | null,"id"?: string,"next_steps"?: string | null,"progress_summary"?: string,"project_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_status_update_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_status_update_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    }
                  ]
                },"project_team_assignment": {
                  Row: {
                    "created_at": string,"created_by": string | null,"organization_id": string,"project_id": string,"role": Database["public"]['Enums']["project_access_role"],"team_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"organization_id": string,"project_id": string,"role"?: Database["public"]['Enums']["project_access_role"],"team_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"organization_id"?: string,"project_id"?: string,"role"?: Database["public"]['Enums']["project_access_role"],"team_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_team_assignment_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_team_assignment_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_team_assignment_project_org_fk"
      columns: ["project_id","organization_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "project_team_assignment_team_org_fk"
      columns: ["team_id","organization_id"]
isOneToOne: false
      referencedRelation: "team"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"project_template": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"created_at": string,"created_by": string | null,"default_stage": string,"id": string,"name": string,"organization_id": string,"outcome": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"default_stage"?: string,"id"?: string,"name": string,"organization_id": string,"outcome"?: string | null
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"default_stage"?: string,"id"?: string,"name"?: string,"organization_id"?: string,"outcome"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_template_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_template_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_template_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"project_template_item": {
                  Row: {
                    "created_at": string,"day_offset": number | null,"description": string | null,"id": string,"kind": string,"name": string,"project_template_id": string,"sort_key": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"day_offset"?: number | null,"description"?: string | null,"id"?: string,"kind": string,"name": string,"project_template_id": string,"sort_key"?: number
                  }
                  Update: {
                    "created_at"?: string,"day_offset"?: number | null,"description"?: string | null,"id"?: string,"kind"?: string,"name"?: string,"project_template_id"?: string,"sort_key"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_template_item_project_template_id_fkey"
      columns: ["project_template_id"]
isOneToOne: false
      referencedRelation: "project_template"
      referencedColumns: ["id"]
    }
                  ]
                },"property_definition": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"id": string,"key": string,"kind": string,"name_en": string,"name_fr": string,"options": NonNullable<Json>,"organization_id": string,"position": number,"system_column": string | null,"type_id": string,"updated_at": string,"visible_to_roles": (Database["public"]['Enums']["org_role"])[] | null
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"id"?: string,"key": string,"kind": string,"name_en": string,"name_fr": string,"options"?: NonNullable<Json>,"organization_id": string,"position"?: number,"system_column"?: string | null,"type_id": string,"updated_at"?: string,"visible_to_roles"?: (Database["public"]['Enums']["org_role"])[] | null
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"id"?: string,"key"?: string,"kind"?: string,"name_en"?: string,"name_fr"?: string,"options"?: NonNullable<Json>,"organization_id"?: string,"position"?: number,"system_column"?: string | null,"type_id"?: string,"updated_at"?: string,"visible_to_roles"?: (Database["public"]['Enums']["org_role"])[] | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "property_definition_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "property_definition_type_id_organization_id_fkey"
      columns: ["type_id","organization_id"]
isOneToOne: false
      referencedRelation: "object_type"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"property_value": {
                  Row: {
                    "object_id": string,"organization_id": string,"property_id": string,"updated_at": string,"updated_by": string | null,"value_bool": boolean | null,"value_date": string | null,"value_date_end": string | null,"value_json": Json | null,"value_number": number | null,"value_text": string | null,"value_uuids": (string)[] | null
                  }
                  ComputedFields: never
                  Insert: {
                    "object_id": string,"organization_id": string,"property_id": string,"updated_at"?: string,"updated_by"?: string | null,"value_bool"?: boolean | null,"value_date"?: string | null,"value_date_end"?: string | null,"value_json"?: Json | null,"value_number"?: number | null,"value_text"?: string | null,"value_uuids"?: (string)[] | null
                  }
                  Update: {
                    "object_id"?: string,"organization_id"?: string,"property_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"value_bool"?: boolean | null,"value_date"?: string | null,"value_date_end"?: string | null,"value_json"?: Json | null,"value_number"?: number | null,"value_text"?: string | null,"value_uuids"?: (string)[] | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "property_value_object_id_fkey"
      columns: ["object_id"]
isOneToOne: false
      referencedRelation: "object"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "property_value_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "property_value_property_id_fkey"
      columns: ["property_id"]
isOneToOne: false
      referencedRelation: "property_definition"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "property_value_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"publication": {
                  Row: {
                    "created_at": string,"fields": (string)[],"id": string,"object_id": string,"organization_id": string,"requested_at": string,"requested_by": string | null,"review_note": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"slug": string,"status": string,"unpublished_at": string | null,"unpublished_by": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"fields": (string)[],"id"?: string,"object_id": string,"organization_id": string,"requested_at"?: string,"requested_by"?: string | null,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"slug": string,"status"?: string,"unpublished_at"?: string | null,"unpublished_by"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"fields"?: (string)[],"id"?: string,"object_id"?: string,"organization_id"?: string,"requested_at"?: string,"requested_by"?: string | null,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"slug"?: string,"status"?: string,"unpublished_at"?: string | null,"unpublished_by"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "publication_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "publication_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "publication_reviewed_by_fkey"
      columns: ["reviewed_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "publication_unpublished_by_fkey"
      columns: ["unpublished_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"published_page": {
                  Row: {
                    "fields": NonNullable<Json>,"publication_id": string,"published_at": string,"slug": string,"title_en": string,"title_fr": string
                  }
                  ComputedFields: never
                  Insert: {
                    "fields": NonNullable<Json>,"publication_id": string,"published_at"?: string,"slug": string,"title_en": string,"title_fr": string
                  }
                  Update: {
                    "fields"?: NonNullable<Json>,"publication_id"?: string,"published_at"?: string,"slug"?: string,"title_en"?: string,"title_fr"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "published_page_publication_id_fkey"
      columns: ["publication_id"]
isOneToOne: true
      referencedRelation: "publication"
      referencedColumns: ["id"]
    }
                  ]
                },"rate_limit_counter": {
                  Row: {
                    "bucket": string,"count": number,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket": string,"count"?: number,"window_start": string
                  }
                  Update: {
                    "bucket"?: string,"count"?: number,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"record_category": {
                  Row: {
                    "confirm_with": string,"default_years": number | null,"description": string,"key": string,"label": string,"legal_reference": string,"minimum_years": number | null,"retention_basis": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "confirm_with": string,"default_years"?: number | null,"description": string,"key": string,"label": string,"legal_reference": string,"minimum_years"?: number | null,"retention_basis": string,"sort_order"?: number
                  }
                  Update: {
                    "confirm_with"?: string,"default_years"?: number | null,"description"?: string,"key"?: string,"label"?: string,"legal_reference"?: string,"minimum_years"?: number | null,"retention_basis"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"record_comment": {
                  Row: {
                    "anchor": Json | null,"author_id": string,"block_id": string | null,"body": string,"created_at": string,"deleted_at": string | null,"deleted_by": string | null,"document_id": string | null,"edited_at": string | null,"id": string,"link_url": string | null,"organization_id": string,"parent_comment_id": string | null,"parent_id": string,"parent_type": string,"resolved_at": string | null,"resolved_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "anchor"?: Json | null,"author_id": string,"block_id"?: string | null,"body": string,"created_at"?: string,"deleted_at"?: string | null,"deleted_by"?: string | null,"document_id"?: string | null,"edited_at"?: string | null,"id"?: string,"link_url"?: string | null,"organization_id": string,"parent_comment_id"?: string | null,"parent_id": string,"parent_type": string,"resolved_at"?: string | null,"resolved_by"?: string | null
                  }
                  Update: {
                    "anchor"?: Json | null,"author_id"?: string,"block_id"?: string | null,"body"?: string,"created_at"?: string,"deleted_at"?: string | null,"deleted_by"?: string | null,"document_id"?: string | null,"edited_at"?: string | null,"id"?: string,"link_url"?: string | null,"organization_id"?: string,"parent_comment_id"?: string | null,"parent_id"?: string,"parent_type"?: string,"resolved_at"?: string | null,"resolved_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "record_comment_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "record_comment_deleted_by_fkey"
      columns: ["deleted_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "record_comment_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "document"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "record_comment_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "record_comment_parent_comment_id_fkey"
      columns: ["parent_comment_id"]
isOneToOne: false
      referencedRelation: "record_comment"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "record_comment_resolved_by_fkey"
      columns: ["resolved_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"record_comment_mention": {
                  Row: {
                    "comment_id": string,"created_at": string,"notified_at": string | null,"organization_id": string,"target_id": string,"target_kind": string
                  }
                  ComputedFields: never
                  Insert: {
                    "comment_id": string,"created_at"?: string,"notified_at"?: string | null,"organization_id": string,"target_id": string,"target_kind": string
                  }
                  Update: {
                    "comment_id"?: string,"created_at"?: string,"notified_at"?: string | null,"organization_id"?: string,"target_id"?: string,"target_kind"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "record_comment_mention_comment_id_fkey"
      columns: ["comment_id"]
isOneToOne: false
      referencedRelation: "record_comment"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "record_comment_mention_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"record_comment_reaction": {
                  Row: {
                    "comment_id": string,"created_at": string,"organization_id": string,"reaction": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "comment_id": string,"created_at"?: string,"organization_id": string,"reaction": string,"user_id"?: string
                  }
                  Update: {
                    "comment_id"?: string,"created_at"?: string,"organization_id"?: string,"reaction"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "record_comment_reaction_comment_id_fkey"
      columns: ["comment_id"]
isOneToOne: false
      referencedRelation: "record_comment"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "record_comment_reaction_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "record_comment_reaction_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"record_retention_report": {
                  Row: {
                    "by_category": NonNullable<Json>,"generated_at": string,"held_count": number,"id": string,"organization_id": string,"past_retention_count": number
                  }
                  ComputedFields: never
                  Insert: {
                    "by_category"?: NonNullable<Json>,"generated_at"?: string,"held_count"?: number,"id"?: string,"organization_id": string,"past_retention_count"?: number
                  }
                  Update: {
                    "by_category"?: NonNullable<Json>,"generated_at"?: string,"held_count"?: number,"id"?: string,"organization_id"?: string,"past_retention_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "record_retention_report_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"record_retention_rule": {
                  Row: {
                    "category_key": string,"confirmation_note": string | null,"confirmed_at": string | null,"confirmed_by": string | null,"created_at": string,"organization_id": string,"retain_years": number | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "category_key": string,"confirmation_note"?: string | null,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"organization_id": string,"retain_years"?: number | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "category_key"?: string,"confirmation_note"?: string | null,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"created_at"?: string,"organization_id"?: string,"retain_years"?: number | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "record_retention_rule_category_key_fkey"
      columns: ["category_key"]
isOneToOne: false
      referencedRelation: "record_category"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "record_retention_rule_confirmed_by_fkey"
      columns: ["confirmed_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "record_retention_rule_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "record_retention_rule_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"record_retention_setting": {
                  Row: {
                    "fiscal_year_end_day": number,"fiscal_year_end_month": number,"organization_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "fiscal_year_end_day": number,"fiscal_year_end_month": number,"organization_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "fiscal_year_end_day"?: number,"fiscal_year_end_month"?: number,"organization_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "record_retention_setting_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: true
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "record_retention_setting_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"record_template": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"created_at": string,"created_by": string | null,"id": string,"kind": string,"name": string,"organization_id": string,"structure": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind": string,"name": string,"organization_id": string,"structure"?: NonNullable<Json>
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind"?: string,"name"?: string,"organization_id"?: string,"structure"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "record_template_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "record_template_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "record_template_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"relation_type": {
                  Row: {
                    "archived_at": string | null,"cardinality": string,"created_at": string,"from_type_id": string | null,"id": string,"is_native": boolean,"key": string,"name_en": string,"name_fr": string,"organization_id": string,"reverse_name_en": string,"reverse_name_fr": string,"to_type_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"cardinality"?: string,"created_at"?: string,"from_type_id"?: string | null,"id"?: string,"is_native"?: boolean,"key": string,"name_en": string,"name_fr": string,"organization_id": string,"reverse_name_en": string,"reverse_name_fr": string,"to_type_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"cardinality"?: string,"created_at"?: string,"from_type_id"?: string | null,"id"?: string,"is_native"?: boolean,"key"?: string,"name_en"?: string,"name_fr"?: string,"organization_id"?: string,"reverse_name_en"?: string,"reverse_name_fr"?: string,"to_type_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "relation_type_from_type_id_organization_id_fkey"
      columns: ["from_type_id","organization_id"]
isOneToOne: false
      referencedRelation: "object_type"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "relation_type_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "relation_type_to_type_id_organization_id_fkey"
      columns: ["to_type_id","organization_id"]
isOneToOne: false
      referencedRelation: "object_type"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"report_approval": {
                  Row: {
                    "decided_at": string,"decided_by": string,"decision": Database["public"]['Enums']["report_decision"],"id": string,"note": string | null,"organization_id": string,"report_version_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "decided_at"?: string,"decided_by": string,"decision": Database["public"]['Enums']["report_decision"],"id"?: string,"note"?: string | null,"organization_id": string,"report_version_id": string
                  }
                  Update: {
                    "decided_at"?: string,"decided_by"?: string,"decision"?: Database["public"]['Enums']["report_decision"],"id"?: string,"note"?: string | null,"organization_id"?: string,"report_version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "report_approval_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "report_approval_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "report_approval_report_version_id_fkey"
      columns: ["report_version_id"]
isOneToOne: false
      referencedRelation: "report_version"
      referencedColumns: ["id"]
    }
                  ]
                },"report_instance": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"created_at": string,"generated_by": string,"id": string,"organization_id": string,"period_end": string | null,"period_start": string | null,"program_id": string | null,"project_id": string | null,"report_type": string,"snapshot": NonNullable<Json>,"status": Database["public"]['Enums']["report_status"],"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"generated_by": string,"id"?: string,"organization_id": string,"period_end"?: string | null,"period_start"?: string | null,"program_id"?: string | null,"project_id"?: string | null,"report_type": string,"snapshot"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["report_status"],"title": string
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"generated_by"?: string,"id"?: string,"organization_id"?: string,"period_end"?: string | null,"period_start"?: string | null,"program_id"?: string | null,"project_id"?: string | null,"report_type"?: string,"snapshot"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["report_status"],"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "report_instance_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "report_instance_generated_by_fkey"
      columns: ["generated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "report_instance_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "report_instance_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "report_instance_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    }
                  ]
                },"report_version": {
                  Row: {
                    "generated_at": string,"generated_by": string,"id": string,"note": string | null,"organization_id": string,"report_id": string,"snapshot": NonNullable<Json>,"version_number": number
                  }
                  ComputedFields: never
                  Insert: {
                    "generated_at"?: string,"generated_by": string,"id"?: string,"note"?: string | null,"organization_id": string,"report_id": string,"snapshot": NonNullable<Json>,"version_number": number
                  }
                  Update: {
                    "generated_at"?: string,"generated_by"?: string,"id"?: string,"note"?: string | null,"organization_id"?: string,"report_id"?: string,"snapshot"?: NonNullable<Json>,"version_number"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "report_version_generated_by_fkey"
      columns: ["generated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "report_version_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "report_version_report_id_fkey"
      columns: ["report_id"]
isOneToOne: false
      referencedRelation: "report_instance"
      referencedColumns: ["id"]
    }
                  ]
                },"retention_policy": {
                  Row: {
                    "action": Database["public"]['Enums']["retention_action"],"created_at": string,"created_by": string | null,"enabled": boolean,"id": string,"last_affected": number | null,"last_run_at": string | null,"note": string | null,"organization_id": string,"retain_days": number,"subject_key": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action"?: Database["public"]['Enums']["retention_action"],"created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"last_affected"?: number | null,"last_run_at"?: string | null,"note"?: string | null,"organization_id": string,"retain_days": number,"subject_key": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "action"?: Database["public"]['Enums']["retention_action"],"created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"last_affected"?: number | null,"last_run_at"?: string | null,"note"?: string | null,"organization_id"?: string,"retain_days"?: number,"subject_key"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "retention_policy_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "retention_policy_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "retention_policy_subject_key_fkey"
      columns: ["subject_key"]
isOneToOne: false
      referencedRelation: "retention_subject"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "retention_policy_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"retention_record_type": {
                  Row: {
                    "key": string,"label": string
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"label": string
                  }
                  Update: {
                    "key"?: string,"label"?: string
                  }
                  Relationships: [
                    
                  ]
                },"retention_run": {
                  Row: {
                    "action": Database["public"]['Enums']["retention_action"],"affected": number,"cutoff": string,"error": string | null,"id": string,"organization_id": string,"policy_id": string | null,"ran_at": string,"subject_key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": Database["public"]['Enums']["retention_action"],"affected"?: number,"cutoff": string,"error"?: string | null,"id"?: string,"organization_id": string,"policy_id"?: string | null,"ran_at"?: string,"subject_key": string
                  }
                  Update: {
                    "action"?: Database["public"]['Enums']["retention_action"],"affected"?: number,"cutoff"?: string,"error"?: string | null,"id"?: string,"organization_id"?: string,"policy_id"?: string | null,"ran_at"?: string,"subject_key"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "retention_run_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "retention_run_policy_id_fkey"
      columns: ["policy_id"]
isOneToOne: false
      referencedRelation: "retention_policy"
      referencedColumns: ["id"]
    }
                  ]
                },"retention_subject": {
                  Row: {
                    "allowed_actions": (Database["public"]['Enums']["retention_action"])[],"caution": string | null,"default_days": number,"description": string,"key": string,"label": string,"minimum_days": number
                  }
                  ComputedFields: never
                  Insert: {
                    "allowed_actions": (Database["public"]['Enums']["retention_action"])[],"caution"?: string | null,"default_days": number,"description": string,"key": string,"label": string,"minimum_days": number
                  }
                  Update: {
                    "allowed_actions"?: (Database["public"]['Enums']["retention_action"])[],"caution"?: string | null,"default_days"?: number,"description"?: string,"key"?: string,"label"?: string,"minimum_days"?: number
                  }
                  Relationships: [
                    
                  ]
                },"risk": {
                  Row: {
                    "closed_at": string | null,"created_at": string,"created_by": string | null,"description": string | null,"id": string,"impact": Database["public"]['Enums']["risk_impact"],"likelihood": Database["public"]['Enums']["risk_likelihood"],"mitigation": string | null,"organization_id": string,"owner_id": string | null,"project_id": string,"review_at": string | null,"score": number | null,"status": Database["public"]['Enums']["risk_status"],"title": string,"trigger": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"impact"?: Database["public"]['Enums']["risk_impact"],"likelihood"?: Database["public"]['Enums']["risk_likelihood"],"mitigation"?: string | null,"organization_id": string,"owner_id"?: string | null,"project_id": string,"review_at"?: string | null,"score"?: never,"status"?: Database["public"]['Enums']["risk_status"],"title": string,"trigger"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "closed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"impact"?: Database["public"]['Enums']["risk_impact"],"likelihood"?: Database["public"]['Enums']["risk_likelihood"],"mitigation"?: string | null,"organization_id"?: string,"owner_id"?: string | null,"project_id"?: string,"review_at"?: string | null,"score"?: never,"status"?: Database["public"]['Enums']["risk_status"],"title"?: string,"trigger"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "risk_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "risk_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "risk_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "risk_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    }
                  ]
                },"sales_tax_line": {
                  Row: {
                    "amount_cents": number,"counterparty": string,"created_at": string,"created_by": string | null,"description": string | null,"direction": string,"gst_cents": number,"id": string,"itc_cents": number,"itr_cents": number,"organization_id": string,"qst_cents": number,"reference": string | null,"source_id": string | null,"source_type": string | null,"tax_code": string,"transaction_date": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"counterparty": string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"direction": string,"gst_cents"?: number,"id"?: string,"itc_cents"?: number,"itr_cents"?: number,"organization_id": string,"qst_cents"?: number,"reference"?: string | null,"source_id"?: string | null,"source_type"?: string | null,"tax_code": string,"transaction_date": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_cents"?: number,"counterparty"?: string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"direction"?: string,"gst_cents"?: number,"id"?: string,"itc_cents"?: number,"itr_cents"?: number,"organization_id"?: string,"qst_cents"?: number,"reference"?: string | null,"source_id"?: string | null,"source_type"?: string | null,"tax_code"?: string,"transaction_date"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sales_tax_line_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_tax_line_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"sales_tax_period": {
                  Row: {
                    "closed_at": string | null,"closed_by": string | null,"closing_entry_id": string | null,"created_at": string,"created_by": string | null,"ends_on": string,"gst_claimed_cents": number | null,"gst_collected_cents": number | null,"id": string,"organization_id": string,"qst_claimed_cents": number | null,"qst_collected_cents": number | null,"starts_on": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"closed_by"?: string | null,"closing_entry_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"ends_on": string,"gst_claimed_cents"?: number | null,"gst_collected_cents"?: number | null,"id"?: string,"organization_id": string,"qst_claimed_cents"?: number | null,"qst_collected_cents"?: number | null,"starts_on": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "closed_at"?: string | null,"closed_by"?: string | null,"closing_entry_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"ends_on"?: string,"gst_claimed_cents"?: number | null,"gst_collected_cents"?: number | null,"id"?: string,"organization_id"?: string,"qst_claimed_cents"?: number | null,"qst_collected_cents"?: number | null,"starts_on"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sales_tax_period_closed_by_fkey"
      columns: ["closed_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_tax_period_closing_entry_id_fkey"
      columns: ["closing_entry_id"]
isOneToOne: false
      referencedRelation: "journal_entry"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_tax_period_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_tax_period_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"sales_tax_rate": {
                  Row: {
                    "effective_from": string,"effective_to": string | null,"id": string,"note": string | null,"rate_percent": number,"tax": string
                  }
                  ComputedFields: never
                  Insert: {
                    "effective_from": string,"effective_to"?: string | null,"id"?: string,"note"?: string | null,"rate_percent": number,"tax": string
                  }
                  Update: {
                    "effective_from"?: string,"effective_to"?: string | null,"id"?: string,"note"?: string | null,"rate_percent"?: number,"tax"?: string
                  }
                  Relationships: [
                    
                  ]
                },"sales_tax_settings": {
                  Row: {
                    "created_at": string,"filing_frequency": string,"gst_number": string | null,"gst_registered": boolean,"itc_claim_bp": number,"organization_id": string,"qst_number": string | null,"qst_registered": boolean,"show_psb_rebate": boolean,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"filing_frequency"?: string,"gst_number"?: string | null,"gst_registered"?: boolean,"itc_claim_bp"?: number,"organization_id": string,"qst_number"?: string | null,"qst_registered"?: boolean,"show_psb_rebate"?: boolean,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"filing_frequency"?: string,"gst_number"?: string | null,"gst_registered"?: boolean,"itc_claim_bp"?: number,"organization_id"?: string,"qst_number"?: string | null,"qst_registered"?: boolean,"show_psb_rebate"?: boolean,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sales_tax_settings_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: true
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_tax_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"saved_message": {
                  Row: {
                    "created_at": string,"message_id": string,"remind_at": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"message_id": string,"remind_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"message_id"?: string,"remind_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "saved_message_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "message"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "saved_message_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"saved_view": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"organization_id": string,"path": string,"query": NonNullable<Json>,"shared": boolean,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"organization_id": string,"path"?: string,"query"?: NonNullable<Json>,"shared"?: boolean,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"organization_id"?: string,"path"?: string,"query"?: NonNullable<Json>,"shared"?: boolean,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "saved_view_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "saved_view_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"scoped_access_backfill_issue": {
                  Row: {
                    "detected_at": string,"id": string,"legacy_role": string | null,"organization_id": string,"reason": string,"scope_id": string,"scope_type": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "detected_at"?: string,"id"?: string,"legacy_role"?: string | null,"organization_id": string,"reason": string,"scope_id": string,"scope_type": string,"user_id"?: string | null
                  }
                  Update: {
                    "detected_at"?: string,"id"?: string,"legacy_role"?: string | null,"organization_id"?: string,"reason"?: string,"scope_id"?: string,"scope_type"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "scoped_access_backfill_issue_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scoped_access_backfill_issue_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"sign_in_rule": {
                  Row: {
                    "max_session_hours": number | null,"organization_id": string,"require_mfa": boolean,"role": Database["public"]['Enums']["org_role"],"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "max_session_hours"?: number | null,"organization_id": string,"require_mfa"?: boolean,"role": Database["public"]['Enums']["org_role"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "max_session_hours"?: number | null,"organization_id"?: string,"require_mfa"?: boolean,"role"?: Database["public"]['Enums']["org_role"],"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sign_in_rule_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sign_in_rule_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"signature": {
                  Row: {
                    "consent_given": boolean,"consent_statement": string,"content_sha256": string,"form_submission_id": string | null,"id": string,"organization_id": string,"signed_at": string,"signer_email": string | null,"signer_id": string,"signer_name": string,"signing_document_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "consent_given": boolean,"consent_statement": string,"content_sha256": string,"form_submission_id"?: string | null,"id"?: string,"organization_id": string,"signed_at"?: string,"signer_email"?: string | null,"signer_id"?: string,"signer_name": string,"signing_document_id"?: string | null
                  }
                  Update: {
                    "consent_given"?: boolean,"consent_statement"?: string,"content_sha256"?: string,"form_submission_id"?: string | null,"id"?: string,"organization_id"?: string,"signed_at"?: string,"signer_email"?: string | null,"signer_id"?: string,"signer_name"?: string,"signing_document_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "signature_form_submission_id_fkey"
      columns: ["form_submission_id"]
isOneToOne: false
      referencedRelation: "form_submission"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signature_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signature_signer_id_fkey"
      columns: ["signer_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signature_signing_document_id_fkey"
      columns: ["signing_document_id"]
isOneToOne: false
      referencedRelation: "signing_document"
      referencedColumns: ["id"]
    }
                  ]
                },"signing_document": {
                  Row: {
                    "content_sha256": string | null,"created_at": string,"file_name": string,"id": string,"message": string | null,"organization_id": string,"quarantined_at": string | null,"scan_attempted_at": string | null,"scan_note": string | null,"scan_status": string,"size_bytes": number | null,"storage_path": string,"title": string,"uploaded_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content_sha256"?: string | null,"created_at"?: string,"file_name": string,"id"?: string,"message"?: string | null,"organization_id": string,"quarantined_at"?: string | null,"scan_attempted_at"?: string | null,"scan_note"?: string | null,"scan_status"?: string,"size_bytes"?: number | null,"storage_path": string,"title": string,"uploaded_by"?: string
                  }
                  Update: {
                    "content_sha256"?: string | null,"created_at"?: string,"file_name"?: string,"id"?: string,"message"?: string | null,"organization_id"?: string,"quarantined_at"?: string | null,"scan_attempted_at"?: string | null,"scan_note"?: string | null,"scan_status"?: string,"size_bytes"?: number | null,"storage_path"?: string,"title"?: string,"uploaded_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "signing_document_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signing_document_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"signing_document_signer": {
                  Row: {
                    "added_at": string,"document_id": string,"organization_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"document_id": string,"organization_id": string,"user_id": string
                  }
                  Update: {
                    "added_at"?: string,"document_id"?: string,"organization_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "signing_document_signer_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "signing_document"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signing_document_signer_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "signing_document_signer_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"space": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"created_by": string | null,"description": string | null,"icon": string | null,"id": string,"kind": string,"name_en": string,"name_fr": string,"organization_id": string,"owner_id": string | null,"program_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"icon"?: string | null,"id"?: string,"kind": string,"name_en": string,"name_fr": string,"organization_id": string,"owner_id"?: string | null,"program_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"icon"?: string | null,"id"?: string,"kind"?: string,"name_en"?: string,"name_fr"?: string,"organization_id"?: string,"owner_id"?: string | null,"program_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "space_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "space_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "space_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "space_program_org_fk"
      columns: ["program_id","organization_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"synced_block": {
                  Row: {
                    "content": NonNullable<Json>,"content_text": string,"created_at": string,"created_by": string,"id": string,"organization_id": string,"source_block_id": string,"source_object_id": string,"source_object_type": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "content"?: NonNullable<Json>,"content_text"?: string,"created_at"?: string,"created_by"?: string,"id"?: string,"organization_id": string,"source_block_id": string,"source_object_id": string,"source_object_type": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "content"?: NonNullable<Json>,"content_text"?: string,"created_at"?: string,"created_by"?: string,"id"?: string,"organization_id"?: string,"source_block_id"?: string,"source_object_id"?: string,"source_object_type"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "synced_block_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "synced_block_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "synced_block_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"synced_block_access_request": {
                  Row: {
                    "created_at": string,"decided_at": string | null,"decided_by": string | null,"id": string,"organization_id": string,"requester_id": string,"status": string,"synced_block_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"id"?: string,"organization_id": string,"requester_id"?: string,"status"?: string,"synced_block_id": string
                  }
                  Update: {
                    "created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"id"?: string,"organization_id"?: string,"requester_id"?: string,"status"?: string,"synced_block_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "synced_block_access_request_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "synced_block_access_request_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "synced_block_access_request_requester_id_fkey"
      columns: ["requester_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "synced_block_access_request_synced_block_id_fkey"
      columns: ["synced_block_id"]
isOneToOne: false
      referencedRelation: "synced_block"
      referencedColumns: ["id"]
    }
                  ]
                },"task": {
                  Row: {
                    "approver_id": string | null,"archived_at": string | null,"assignee_id": string | null,"blocked_by_id": string | null,"blocked_reason": string | null,"completed_at": string | null,"completion_criteria": string | null,"created_at": string,"created_by": string | null,"description": string | null,"due_at": string | null,"estimate_hours": number | null,"id": string,"milestone_id": string | null,"occurrence_date": string | null,"organization_id": string,"priority": Database["public"]['Enums']["task_priority"],"program_id": string | null,"project_id": string | null,"recurrence_anchor": string | null,"recurrence_parent_id": string | null,"recurrence_rule": string | null,"requester_id": string | null,"reviewer_id": string | null,"series_edited_at": string | null,"series_id": string | null,"sort_key": number,"source_id": string | null,"source_message_id": string | null,"source_type": string,"start_at": string | null,"status": Database["public"]['Enums']["task_status"],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approver_id"?: string | null,"archived_at"?: string | null,"assignee_id"?: string | null,"blocked_by_id"?: string | null,"blocked_reason"?: string | null,"completed_at"?: string | null,"completion_criteria"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"due_at"?: string | null,"estimate_hours"?: number | null,"id"?: string,"milestone_id"?: string | null,"occurrence_date"?: string | null,"organization_id": string,"priority"?: Database["public"]['Enums']["task_priority"],"program_id"?: string | null,"project_id"?: string | null,"recurrence_anchor"?: string | null,"recurrence_parent_id"?: string | null,"recurrence_rule"?: string | null,"requester_id"?: string | null,"reviewer_id"?: string | null,"series_edited_at"?: string | null,"series_id"?: string | null,"sort_key"?: number,"source_id"?: string | null,"source_message_id"?: string | null,"source_type"?: string,"start_at"?: string | null,"status"?: Database["public"]['Enums']["task_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "approver_id"?: string | null,"archived_at"?: string | null,"assignee_id"?: string | null,"blocked_by_id"?: string | null,"blocked_reason"?: string | null,"completed_at"?: string | null,"completion_criteria"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"due_at"?: string | null,"estimate_hours"?: number | null,"id"?: string,"milestone_id"?: string | null,"occurrence_date"?: string | null,"organization_id"?: string,"priority"?: Database["public"]['Enums']["task_priority"],"program_id"?: string | null,"project_id"?: string | null,"recurrence_anchor"?: string | null,"recurrence_parent_id"?: string | null,"recurrence_rule"?: string | null,"requester_id"?: string | null,"reviewer_id"?: string | null,"series_edited_at"?: string | null,"series_id"?: string | null,"sort_key"?: number,"source_id"?: string | null,"source_message_id"?: string | null,"source_type"?: string,"start_at"?: string | null,"status"?: Database["public"]['Enums']["task_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fk_task_source_message"
      columns: ["source_message_id"]
isOneToOne: false
      referencedRelation: "message"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_approver_id_fkey"
      columns: ["approver_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_assignee_id_fkey"
      columns: ["assignee_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_blocked_by_id_fkey"
      columns: ["blocked_by_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_milestone_id_fkey"
      columns: ["milestone_id"]
isOneToOne: false
      referencedRelation: "milestone"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_program_id_fkey"
      columns: ["program_id"]
isOneToOne: false
      referencedRelation: "program"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_recurrence_parent_id_fkey"
      columns: ["recurrence_parent_id"]
isOneToOne: false
      referencedRelation: "task"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_requester_id_fkey"
      columns: ["requester_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_reviewer_id_fkey"
      columns: ["reviewer_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_series_id_fkey"
      columns: ["series_id"]
isOneToOne: false
      referencedRelation: "task_series"
      referencedColumns: ["id"]
    }
                  ]
                },"task_assignment": {
                  Row: {
                    "created_at": string,"role": string,"task_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"role": string,"task_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"role"?: string,"task_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_assignment_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "task"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_assignment_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"task_comment": {
                  Row: {
                    "author_id": string,"body": string,"created_at": string,"deleted_at": string | null,"edited_at": string | null,"id": string,"task_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"body": string,"created_at"?: string,"deleted_at"?: string | null,"edited_at"?: string | null,"id"?: string,"task_id": string
                  }
                  Update: {
                    "author_id"?: string,"body"?: string,"created_at"?: string,"deleted_at"?: string | null,"edited_at"?: string | null,"id"?: string,"task_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_comment_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_comment_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "task"
      referencedColumns: ["id"]
    }
                  ]
                },"task_dependency": {
                  Row: {
                    "blocked_task_id": string,"blocking_task_id": string,"created_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "blocked_task_id": string,"blocking_task_id": string,"created_at"?: string
                  }
                  Update: {
                    "blocked_task_id"?: string,"blocking_task_id"?: string,"created_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_dependency_blocked_task_id_fkey"
      columns: ["blocked_task_id"]
isOneToOne: false
      referencedRelation: "task"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_dependency_blocking_task_id_fkey"
      columns: ["blocking_task_id"]
isOneToOne: false
      referencedRelation: "task"
      referencedColumns: ["id"]
    }
                  ]
                },"task_label": {
                  Row: {
                    "label_id": string,"task_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "label_id": string,"task_id": string
                  }
                  Update: {
                    "label_id"?: string,"task_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_label_label_id_fkey"
      columns: ["label_id"]
isOneToOne: false
      referencedRelation: "label"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_label_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "task"
      referencedColumns: ["id"]
    }
                  ]
                },"task_series": {
                  Row: {
                    "created_at": string,"id": string,"organization_id": string,"owner_id": string,"project_id": string | null,"recurrence_anchor": string,"recurrence_rule": string,"stopped_at": string | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"organization_id": string,"owner_id": string,"project_id"?: string | null,"recurrence_anchor": string,"recurrence_rule": string,"stopped_at"?: string | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"organization_id"?: string,"owner_id"?: string,"project_id"?: string | null,"recurrence_anchor"?: string,"recurrence_rule"?: string,"stopped_at"?: string | null,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_series_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_series_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_series_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "project"
      referencedColumns: ["id"]
    }
                  ]
                },"team": {
                  Row: {
                    "created_at": string,"description": string | null,"id": string,"name": string,"organization_id": string,"owner_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"name": string,"organization_id": string,"owner_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"name"?: string,"organization_id"?: string,"owner_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_owner_membership_fk"
      columns: ["organization_id","owner_id"]
isOneToOne: false
      referencedRelation: "organization_membership"
      referencedColumns: ["organization_id","user_id"]
    }
                  ]
                },"team_member": {
                  Row: {
                    "created_at": string,"organization_id": string,"team_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"organization_id": string,"team_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"organization_id"?: string,"team_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_member_org_membership_fk"
      columns: ["organization_id","user_id"]
isOneToOne: false
      referencedRelation: "organization_membership"
      referencedColumns: ["organization_id","user_id"]
    },{
      foreignKeyName: "team_member_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "team"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_member_team_org_fk"
      columns: ["team_id","organization_id"]
isOneToOne: false
      referencedRelation: "team"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "team_member_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"team_signal": {
                  Row: {
                    "closed_on": string | null,"created_at": string,"id": string,"item_count": number,"kind": string,"last_seen_on": string,"opened_on": string,"organization_id": string,"reminded_at": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_on"?: string | null,"created_at"?: string,"id"?: string,"item_count"?: number,"kind": string,"last_seen_on": string,"opened_on": string,"organization_id": string,"reminded_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "closed_on"?: string | null,"created_at"?: string,"id"?: string,"item_count"?: number,"kind"?: string,"last_seen_on"?: string,"opened_on"?: string,"organization_id"?: string,"reminded_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_signal_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_signal_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"team_signal_settings": {
                  Row: {
                    "blocked_no_update_days": number,"digest_enabled": boolean,"flag_overdue_decisions": boolean,"flag_project_reports": boolean,"in_progress_no_update_days": number,"organization_id": string,"overdue_age_days": number,"overdue_count": number,"reminders_enabled": boolean,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "blocked_no_update_days"?: number,"digest_enabled"?: boolean,"flag_overdue_decisions"?: boolean,"flag_project_reports"?: boolean,"in_progress_no_update_days"?: number,"organization_id": string,"overdue_age_days"?: number,"overdue_count"?: number,"reminders_enabled"?: boolean,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "blocked_no_update_days"?: number,"digest_enabled"?: boolean,"flag_overdue_decisions"?: boolean,"flag_project_reports"?: boolean,"in_progress_no_update_days"?: number,"organization_id"?: string,"overdue_age_days"?: number,"overdue_count"?: number,"reminders_enabled"?: boolean,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_signal_settings_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: true
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_signal_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"template_v2": {
                  Row: {
                    "body": NonNullable<Json>,"created_at": string,"created_by": string | null,"description_en": string | null,"description_fr": string | null,"id": string,"name_en": string,"name_fr": string,"organization_id": string,"scope": string,"status": string,"type_key": string | null,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "body": NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"description_en"?: string | null,"description_fr"?: string | null,"id"?: string,"name_en": string,"name_fr": string,"organization_id": string,"scope": string,"status"?: string,"type_key"?: string | null,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "body"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"description_en"?: string | null,"description_fr"?: string | null,"id"?: string,"name_en"?: string,"name_fr"?: string,"organization_id"?: string,"scope"?: string,"status"?: string,"type_key"?: string | null,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "template_v2_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "template_v2_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"template_v2_version": {
                  Row: {
                    "body": NonNullable<Json>,"created_at": string,"created_by": string | null,"description_en": string | null,"description_fr": string | null,"id": string,"name_en": string,"name_fr": string,"organization_id": string,"template_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "body": NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"description_en"?: string | null,"description_fr"?: string | null,"id"?: string,"name_en": string,"name_fr": string,"organization_id": string,"template_id": string,"version": number
                  }
                  Update: {
                    "body"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"description_en"?: string | null,"description_fr"?: string | null,"id"?: string,"name_en"?: string,"name_fr"?: string,"organization_id"?: string,"template_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "template_v2_version_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "template_v2_version_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "template_v2_version_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "template_v2"
      referencedColumns: ["id"]
    }
                  ]
                },"upkeep_review": {
                  Row: {
                    "decision": string,"id": string,"note": string | null,"object_id": string,"object_type": string,"organization_id": string,"reviewed_at": string,"reviewed_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "decision": string,"id"?: string,"note"?: string | null,"object_id": string,"object_type": string,"organization_id": string,"reviewed_at"?: string,"reviewed_by"?: string
                  }
                  Update: {
                    "decision"?: string,"id"?: string,"note"?: string | null,"object_id"?: string,"object_type"?: string,"organization_id"?: string,"reviewed_at"?: string,"reviewed_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "upkeep_review_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "upkeep_review_reviewed_by_fkey"
      columns: ["reviewed_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"user_profile": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"display_density": string,"email": string,"full_name": string,"id": string,"locale": string | null,"onboarded_at": string | null,"reduce_motion": boolean,"timezone": string | null,"title": string | null,"updated_at": string,"vms_availability": string,"vms_id": string | null,"vms_synced_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_density"?: string,"email"?: string,"full_name"?: string,"id": string,"locale"?: string | null,"onboarded_at"?: string | null,"reduce_motion"?: boolean,"timezone"?: string | null,"title"?: string | null,"updated_at"?: string,"vms_availability"?: string,"vms_id"?: string | null,"vms_synced_at"?: string | null
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_density"?: string,"email"?: string,"full_name"?: string,"id"?: string,"locale"?: string | null,"onboarded_at"?: string | null,"reduce_motion"?: boolean,"timezone"?: string | null,"title"?: string | null,"updated_at"?: string,"vms_availability"?: string,"vms_id"?: string | null,"vms_synced_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"vms_assignment_reference": {
                  Row: {
                    "created_at": string,"ends_at": string | null,"external_assignment_id": string,"external_updated_at": string | null,"id": string,"last_seen_at": string,"organization_id": string,"source_url": string | null,"starts_at": string | null,"status": string,"title": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"ends_at"?: string | null,"external_assignment_id": string,"external_updated_at"?: string | null,"id"?: string,"last_seen_at"?: string,"organization_id": string,"source_url"?: string | null,"starts_at"?: string | null,"status"?: string,"title": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"ends_at"?: string | null,"external_assignment_id"?: string,"external_updated_at"?: string | null,"id"?: string,"last_seen_at"?: string,"organization_id"?: string,"source_url"?: string | null,"starts_at"?: string | null,"status"?: string,"title"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "vms_assignment_reference_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vms_assignment_reference_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"workflow_event_cursor": {
                  Row: {
                    "consumer": string,"last_created_at": string | null,"last_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "consumer": string,"last_created_at"?: string | null,"last_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "consumer"?: string,"last_created_at"?: string | null,"last_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"workflow_execution": {
                  Row: {
                    "actor_id": string | null,"actor_kind": string | null,"attempt": number,"created_at": string,"detail": string | null,"engine": string,"finished_at": string | null,"id": string,"is_test": boolean,"organization_id": string,"outcome": string,"parent_execution_id": string | null,"payload": Json | null,"recipient_count": number,"resume_at": string | null,"resume_attempt": number | null,"resume_step_id": string | null,"retry_of": string | null,"rule_id": string | null,"rule_name": string,"run_number": number,"run_state": Json | null,"source_id": string,"source_type": string,"started_at": string | null,"trigger_event": string,"trigger_event_id": string | null,"trigger_payload": Json | null,"waiting_on_id": string | null,"waiting_on_kind": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"actor_kind"?: string | null,"attempt"?: number,"created_at"?: string,"detail"?: string | null,"engine"?: string,"finished_at"?: string | null,"id"?: string,"is_test"?: boolean,"organization_id": string,"outcome": string,"parent_execution_id"?: string | null,"payload"?: Json | null,"recipient_count"?: number,"resume_at"?: string | null,"resume_attempt"?: number | null,"resume_step_id"?: string | null,"retry_of"?: string | null,"rule_id"?: string | null,"rule_name": string,"run_number"?: number,"run_state"?: Json | null,"source_id": string,"source_type": string,"started_at"?: string | null,"trigger_event": string,"trigger_event_id"?: string | null,"trigger_payload"?: Json | null,"waiting_on_id"?: string | null,"waiting_on_kind"?: string | null
                  }
                  Update: {
                    "actor_id"?: string | null,"actor_kind"?: string | null,"attempt"?: number,"created_at"?: string,"detail"?: string | null,"engine"?: string,"finished_at"?: string | null,"id"?: string,"is_test"?: boolean,"organization_id"?: string,"outcome"?: string,"parent_execution_id"?: string | null,"payload"?: Json | null,"recipient_count"?: number,"resume_at"?: string | null,"resume_attempt"?: number | null,"resume_step_id"?: string | null,"retry_of"?: string | null,"rule_id"?: string | null,"rule_name"?: string,"run_number"?: number,"run_state"?: Json | null,"source_id"?: string,"source_type"?: string,"started_at"?: string | null,"trigger_event"?: string,"trigger_event_id"?: string | null,"trigger_payload"?: Json | null,"waiting_on_id"?: string | null,"waiting_on_kind"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "workflow_execution_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workflow_execution_parent_execution_id_fkey"
      columns: ["parent_execution_id"]
isOneToOne: false
      referencedRelation: "workflow_execution"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workflow_execution_retry_of_fkey"
      columns: ["retry_of"]
isOneToOne: false
      referencedRelation: "workflow_execution"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workflow_execution_rule_id_fkey"
      columns: ["rule_id"]
isOneToOne: false
      referencedRelation: "workflow_rule"
      referencedColumns: ["id"]
    }
                  ]
                },"workflow_execution_step": {
                  Row: {
                    "attempt": number,"error": string | null,"execution_id": string,"finished_at": string | null,"id": string,"input": Json | null,"organization_id": string,"output": Json | null,"position": number,"started_at": string,"status": string,"step_id": string,"step_kind": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempt"?: number,"error"?: string | null,"execution_id": string,"finished_at"?: string | null,"id"?: string,"input"?: Json | null,"organization_id": string,"output"?: Json | null,"position": number,"started_at"?: string,"status": string,"step_id": string,"step_kind": string
                  }
                  Update: {
                    "attempt"?: number,"error"?: string | null,"execution_id"?: string,"finished_at"?: string | null,"id"?: string,"input"?: Json | null,"organization_id"?: string,"output"?: Json | null,"position"?: number,"started_at"?: string,"status"?: string,"step_id"?: string,"step_kind"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workflow_execution_step_execution_id_fkey"
      columns: ["execution_id"]
isOneToOne: false
      referencedRelation: "workflow_execution"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workflow_execution_step_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"workflow_review": {
                  Row: {
                    "comment": string | null,"created_at": string,"decided_at": string | null,"execution_id": string,"id": string,"instructions": string,"organization_id": string,"reviewer_id": string,"status": string,"step_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "comment"?: string | null,"created_at"?: string,"decided_at"?: string | null,"execution_id": string,"id"?: string,"instructions": string,"organization_id": string,"reviewer_id": string,"status"?: string,"step_id": string
                  }
                  Update: {
                    "comment"?: string | null,"created_at"?: string,"decided_at"?: string | null,"execution_id"?: string,"id"?: string,"instructions"?: string,"organization_id"?: string,"reviewer_id"?: string,"status"?: string,"step_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workflow_review_execution_id_fkey"
      columns: ["execution_id"]
isOneToOne: false
      referencedRelation: "workflow_execution"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workflow_review_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workflow_review_reviewer_id_fkey"
      columns: ["reviewer_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"workflow_rule": {
                  Row: {
                    "action": NonNullable<Json>,"condition": NonNullable<Json>,"created_at": string,"created_by": string | null,"definition_version": number,"description": string | null,"enabled": boolean,"engine": string,"graph": Json | null,"id": string,"max_runs_per_hour": number,"name": string,"organization_id": string,"run_as_user_id": string | null,"stopped_at": string | null,"stopped_by": string | null,"trigger_event": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action"?: NonNullable<Json>,"condition"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"definition_version"?: number,"description"?: string | null,"enabled"?: boolean,"engine"?: string,"graph"?: Json | null,"id"?: string,"max_runs_per_hour"?: number,"name": string,"organization_id": string,"run_as_user_id"?: string | null,"stopped_at"?: string | null,"stopped_by"?: string | null,"trigger_event": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "action"?: NonNullable<Json>,"condition"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"definition_version"?: number,"description"?: string | null,"enabled"?: boolean,"engine"?: string,"graph"?: Json | null,"id"?: string,"max_runs_per_hour"?: number,"name"?: string,"organization_id"?: string,"run_as_user_id"?: string | null,"stopped_at"?: string | null,"stopped_by"?: string | null,"trigger_event"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "workflow_rule_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workflow_rule_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workflow_rule_run_as_user_id_fkey"
      columns: ["run_as_user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workflow_rule_stopped_by_fkey"
      columns: ["stopped_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workflow_rule_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"workflow_webhook_secret": {
                  Row: {
                    "created_at": string,"organization_id": string,"rule_id": string,"secret": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"organization_id": string,"rule_id": string,"secret": string
                  }
                  Update: {
                    "created_at"?: string,"organization_id"?: string,"rule_id"?: string,"secret"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workflow_webhook_secret_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workflow_webhook_secret_rule_id_fkey"
      columns: ["rule_id"]
isOneToOne: true
      referencedRelation: "workflow_rule"
      referencedColumns: ["id"]
    }
                  ]
                },"workspace_app": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"created_by": string | null,"definition": NonNullable<Json>,"description_en": string,"description_fr": string,"icon": string | null,"id": string,"name_en": string,"name_fr": string,"organization_id": string,"published_at": string | null,"slug": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"definition": NonNullable<Json>,"description_en"?: string,"description_fr"?: string,"icon"?: string | null,"id"?: string,"name_en": string,"name_fr": string,"organization_id": string,"published_at"?: string | null,"slug": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"definition"?: NonNullable<Json>,"description_en"?: string,"description_fr"?: string,"icon"?: string | null,"id"?: string,"name_en"?: string,"name_fr"?: string,"organization_id"?: string,"published_at"?: string | null,"slug"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_app_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workspace_app_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workspace_app_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"workspace_app_grant": {
                  Row: {
                    "app_id": string,"capabilities": (string)[],"created_at": string,"created_by": string | null,"id": string,"org_role": Database["public"]['Enums']["org_role"] | null,"organization_id": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "app_id": string,"capabilities": (string)[],"created_at"?: string,"created_by"?: string | null,"id"?: string,"org_role"?: Database["public"]['Enums']["org_role"] | null,"organization_id": string,"user_id"?: string | null
                  }
                  Update: {
                    "app_id"?: string,"capabilities"?: (string)[],"created_at"?: string,"created_by"?: string | null,"id"?: string,"org_role"?: Database["public"]['Enums']["org_role"] | null,"organization_id"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_app_grant_app_id_fkey"
      columns: ["app_id"]
isOneToOne: false
      referencedRelation: "workspace_app"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workspace_app_grant_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workspace_app_grant_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workspace_app_grant_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    }
                  ]
                },"zeffy_campaign": {
                  Row: {
                    "campaign_type": string | null,"category": string | null,"currency": string | null,"deleted_at": string | null,"ends_at": string | null,"goal_cents": number | null,"id": string,"is_archived": boolean,"organization_id": string,"raised_cents": number | null,"starts_at": string | null,"status": string | null,"synced_at": string,"title": string,"url": string | null,"zeffy_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_type"?: string | null,"category"?: string | null,"currency"?: string | null,"deleted_at"?: string | null,"ends_at"?: string | null,"goal_cents"?: number | null,"id"?: string,"is_archived"?: boolean,"organization_id": string,"raised_cents"?: number | null,"starts_at"?: string | null,"status"?: string | null,"synced_at"?: string,"title"?: string,"url"?: string | null,"zeffy_id": string
                  }
                  Update: {
                    "campaign_type"?: string | null,"category"?: string | null,"currency"?: string | null,"deleted_at"?: string | null,"ends_at"?: string | null,"goal_cents"?: number | null,"id"?: string,"is_archived"?: boolean,"organization_id"?: string,"raised_cents"?: number | null,"starts_at"?: string | null,"status"?: string | null,"synced_at"?: string,"title"?: string,"url"?: string | null,"zeffy_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "zeffy_campaign_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"zeffy_contact_match": {
                  Row: {
                    "candidate_ids": (string)[],"created_at": string,"email": string | null,"full_name": string,"id": string,"organization_id": string,"resolved_at": string | null,"zeffy_contact_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "candidate_ids"?: (string)[],"created_at"?: string,"email"?: string | null,"full_name"?: string,"id"?: string,"organization_id": string,"resolved_at"?: string | null,"zeffy_contact_id": string
                  }
                  Update: {
                    "candidate_ids"?: (string)[],"created_at"?: string,"email"?: string | null,"full_name"?: string,"id"?: string,"organization_id"?: string,"resolved_at"?: string | null,"zeffy_contact_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "zeffy_contact_match_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"zeffy_payment": {
                  Row: {
                    "amount_cents": number,"campaign_category": string | null,"campaign_title": string | null,"company_name": string | null,"currency": string,"deleted_at": string | null,"dispute_status": string | null,"eligible_amount_cents": number | null,"fund_code": string | null,"fund_names": Json | null,"id": string,"is_recurring": boolean,"item_kinds": (string)[],"items": NonNullable<Json>,"organization_id": string,"paid_at": string,"payment_type": string | null,"receipt_url": string | null,"recurring_interval": string | null,"recurring_status": string | null,"refund_status": string,"refunded_cents": number,"status": string,"synced_at": string,"zeffy_campaign_id": string | null,"zeffy_contact_id": string | null,"zeffy_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"campaign_category"?: string | null,"campaign_title"?: string | null,"company_name"?: string | null,"currency": string,"deleted_at"?: string | null,"dispute_status"?: string | null,"eligible_amount_cents"?: number | null,"fund_code"?: string | null,"fund_names"?: Json | null,"id"?: string,"is_recurring"?: boolean,"item_kinds"?: (string)[],"items"?: NonNullable<Json>,"organization_id": string,"paid_at": string,"payment_type"?: string | null,"receipt_url"?: string | null,"recurring_interval"?: string | null,"recurring_status"?: string | null,"refund_status"?: string,"refunded_cents"?: number,"status": string,"synced_at"?: string,"zeffy_campaign_id"?: string | null,"zeffy_contact_id"?: string | null,"zeffy_id": string
                  }
                  Update: {
                    "amount_cents"?: number,"campaign_category"?: string | null,"campaign_title"?: string | null,"company_name"?: string | null,"currency"?: string,"deleted_at"?: string | null,"dispute_status"?: string | null,"eligible_amount_cents"?: number | null,"fund_code"?: string | null,"fund_names"?: Json | null,"id"?: string,"is_recurring"?: boolean,"item_kinds"?: (string)[],"items"?: NonNullable<Json>,"organization_id"?: string,"paid_at"?: string,"payment_type"?: string | null,"receipt_url"?: string | null,"recurring_interval"?: string | null,"recurring_status"?: string | null,"refund_status"?: string,"refunded_cents"?: number,"status"?: string,"synced_at"?: string,"zeffy_campaign_id"?: string | null,"zeffy_contact_id"?: string | null,"zeffy_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "zeffy_payment_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"zeffy_suppressed_contact": {
                  Row: {
                    "created_at": string,"created_by": string | null,"email_sha256": string | null,"organization_id": string,"zeffy_contact_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"email_sha256"?: string | null,"organization_id": string,"zeffy_contact_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"email_sha256"?: string | null,"organization_id"?: string,"zeffy_contact_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "zeffy_suppressed_contact_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "user_profile"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "zeffy_suppressed_contact_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"zeffy_sync_state": {
                  Row: {
                    "last_webhook_at": string | null,"organization_id": string,"state": NonNullable<Json>,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "last_webhook_at"?: string | null,"organization_id": string,"state"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "last_webhook_at"?: string | null,"organization_id"?: string,"state"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "zeffy_sync_state_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: true
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                },"zeffy_webhook_event": {
                  Row: {
                    "attempts": number,"event_id": string,"event_type": string,"last_error": string | null,"organization_id": string | null,"processed_at": string | null,"received_at": string,"resource_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"event_id": string,"event_type": string,"last_error"?: string | null,"organization_id"?: string | null,"processed_at"?: string | null,"received_at"?: string,"resource_id"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"event_id"?: string,"event_type"?: string,"last_error"?: string | null,"organization_id"?: string | null,"processed_at"?: string | null,"received_at"?: string,"resource_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "zeffy_webhook_event_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organization"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "object_activity_feed": {
                  Row: {
                    "actor_id": string | null,"actor_kind": string | null,"created_at": string | null,"id": string | null,"metadata": Json | null,"organization_id": string | null,"origin": string | null,"program_id": string | null,"project_id": string | null,"source_id": string | null,"source_type": string | null,"summary": string | null,"verb": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"object_material_audit": {
                  Row: {
                    "action": string | null,"event_id": string | null,"event_type": string | null,"metadata": Json | null,"object_id": string | null,"object_type": string | null,"occurred_at": string | null,"organization_id": string | null,"seq": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"object_relation_all": {
                  Row: {
                    "created_at": string | null,"from_id": string | null,"from_type": string | null,"id": string | null,"organization_id": string | null,"position": number | null,"relation_type_key": string | null,"source": string | null,"to_id": string | null,"to_type": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "access_ancestors":
{ Args: { "object_id": string }; Returns: (string)[]
                           },
"access_role_usage":
{ Args: Record<PropertyKey, never>; Returns: {
              "grants": number,"role_id": string
            }[]
                           },
"actor_can_read_report":
{ Args: { "p_report": string,"p_user": string }; Returns: boolean
                           },
"actor_has_program_capability":
{ Args: { "p_capability": string,"p_program": string,"p_user": string }; Returns: boolean
                           },
"actor_has_project_capability":
{ Args: { "p_capability": string,"p_project": string,"p_user": string }; Returns: boolean
                           },
"add_channel_member":
{ Args: { "p_channel_id": string,"p_user_id": string }; Returns: boolean
                           },
"add_team_member":
{ Args: { "p_team_id": string,"p_user_id": string }; Returns: boolean
                           },
"api_list_objects":
{ Args: { "p_after_id"?: string,"p_after_updated"?: string,"p_limit"?: number,"p_organization": string,"p_type"?: string,"p_user": string }; Returns: {
              "archived_at": string,"created_at": string,"id": string,"owner_id": string,"parent_object_id": string,"title": string,"type": string,"updated_at": string
            }[]
                           },
"append_editor_operations":
{ Args: { "p_base_version": number,"p_object": string,"p_ops": Json,"p_type": string }; Returns: {
              "seq": number,"version": number
            }[]
                           },
"apply_page_template_v2":
{ Args: { "p_parent": string,"p_program"?: string,"p_start": string,"p_template": string,"p_title": string,"p_variables"?: Json }; Returns: string
                           },
"apply_task_update_as":
{ Args: { "p_actor": string,"p_organization": string,"p_patch": Json,"p_task": string }; Returns: string
                           },
"apply_template_v2":
{ Args: { "p_locale"?: string,"p_program_id"?: string,"p_project_id"?: string,"p_start": string,"p_template_id": string }; Returns: {
              "object_id": string,"object_type": string
            }[]
                           },
"approval_inbox":
{ Args: Record<PropertyKey, never>; Returns: {
              "amount_cents": number | null,
"created_at": string,
"current_step": number | null,
"decided_at": string | null,
"decided_by": string | null,
"decision_note": string | null,
"description": string | null,
"id": string,
"organization_id": string,
"program_id": string | null,
"requested_by": string,
"status": string,
"subject_id": string | null,
"subject_type": string,
"title": string,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "approval_item"
        isOneToOne: false
        isSetofReturn: true
      } },
"approve_project_request":
{ Args: { "p_decision_note"?: string,"p_project_name"?: string,"p_request_id": string }; Returns: string
                           },
"bank_create_entry":
{ Args: { "p_contra_account": string,"p_fund": string,"p_memo": string,"p_program": string,"p_transaction": string }; Returns: string
                           },
"bank_delete_import":
{ Args: { "p_import": string }; Returns: undefined
                           },
"bank_delete_reconciliation":
{ Args: { "p_reconciliation": string }; Returns: undefined
                           },
"bank_import_statement":
{ Args: { "p_bank_account": string,"p_file_format": string,"p_file_name": string,"p_file_sha256": string,"p_layout": string,"p_lines": Json }; Returns: Json
                           },
"bank_match_candidates":
{ Args: { "p_bank_account": string,"p_from": string,"p_to": string,"p_window_days"?: number }; Returns: {
              "bank_transaction_id": string,"day_gap": number,"entry_date": string,"entry_id": string,"entry_number": number,"journal_line_id": string,"memo": string
            }[]
                           },
"bank_match_line":
{ Args: { "p_journal_line": string,"p_method": string,"p_transaction": string }; Returns: undefined
                           },
"bank_reconciliation_outstanding":
{ Args: { "p_reconciliation": string }; Returns: {
              "amount_cents": number,"entry_date": string,"entry_id": string,"entry_number": number,"journal_line_id": string,"memo": string
            }[]
                           },
"bank_reconciliation_summary":
{ Args: { "p_reconciliation": string }; Returns: {
              "cleared_balance_cents": number,"difference_cents": number,"ledger_balance_cents": number,"outstanding_cents": number,"outstanding_count": number,"statement_gap_cents": number,"statement_lines_cents": number,"unmatched_cents": number,"unmatched_count": number
            }[]
                           },
"bank_save_account":
{ Args: { "p_account_last4": string,"p_default_fund": string,"p_id": string,"p_institution": string,"p_is_active": boolean,"p_ledger_account": string,"p_name": string,"p_organization": string,"p_reconcile_from": string }; Returns: string
                           },
"bank_set_reconciliation_status":
{ Args: { "p_reconciliation": string,"p_status": string }; Returns: undefined
                           },
"bank_start_reconciliation":
{ Args: { "p_bank_account": string,"p_closing_balance_cents": number,"p_opening_balance_cents": number,"p_statement_end": string,"p_statement_start": string }; Returns: string
                           },
"bank_statement_lines":
{ Args: { "p_bank_account": string,"p_from": string,"p_to": string }; Returns: {
              "amount_cents": number,"description": string,"entry_date": string,"entry_id": string,"entry_memo": string,"entry_number": number,"id": string,"import_id": string,"journal_line_id": string,"locked": boolean,"match_method": string,"posted_on": string,"reference": string
            }[]
                           },
"bank_unmatch_line":
{ Args: { "p_transaction": string }; Returns: undefined
                           },
"bank_update_reconciliation":
{ Args: { "p_closing_balance_cents": number,"p_opening_balance_cents": number,"p_reconciliation": string }; Returns: undefined
                           },
"blueprint_approve":
{ Args: { "p_blueprint": string }; Returns: undefined
                           },
"blueprint_build":
{ Args: { "p_blueprint": string,"p_changes": Json,"p_counts": Json }; Returns: string
                           },
"blueprint_undo_build":
{ Args: { "p_change_set": string }; Returns: string
                           },
"budget_approve":
{ Args: { "p_budget": string }; Returns: undefined
                           },
"budget_create":
{ Args: { "p_fiscal_year_start": string,"p_name": string,"p_notes": string,"p_organization": string }; Returns: string
                           },
"budget_delete_draft":
{ Args: { "p_budget": string }; Returns: undefined
                           },
"budget_delete_line":
{ Args: { "p_line": string }; Returns: undefined
                           },
"budget_managed_programs":
{ Args: { "p_organization": string }; Returns: {
              "name": string,"program_id": string
            }[]
                           },
"budget_program_summary":
{ Args: { "p_month": string,"p_program": string }; Returns: {
              "account_id": string,"account_type": string,"annual_budget_cents": number,"budget_id": string,"budget_name": string,"budget_version": number,"code": string,"fiscal_year_start": string,"month_actual_cents": number,"month_budget_cents": number,"name": string,"ytd_actual_cents": number,"ytd_budget_cents": number
            }[]
                           },
"budget_revise":
{ Args: { "p_budget": string }; Returns: string
                           },
"budget_save_line":
{ Args: { "p_account": string,"p_budget": string,"p_fund": string,"p_line": string,"p_month_cents": (number)[],"p_note": string,"p_program": string,"p_project": string }; Returns: string
                           },
"budget_vs_actual":
{ Args: { "p_budget": string,"p_fund"?: string,"p_month": string,"p_program"?: string,"p_project"?: string }; Returns: {
              "account_id": string,"account_type": string,"annual_budget_cents": number,"code": string,"month_actual_cents": number,"month_budget_cents": number,"name": string,"ytd_actual_cents": number,"ytd_budget_cents": number
            }[]
                           },
"can":
{ Args: { "capability": string,"object_id": string }; Returns: boolean
                           },
"can_as":
{ Args: { "p_assurance"?: string,"p_capability": string,"p_object": string,"p_user": string }; Returns: boolean
                           },
"can_create_in_space":
{ Args: { "space_id": string }; Returns: boolean
                           },
"can_create_scoped_task":
{ Args: { "p_organization": string,"p_program": string,"p_project": string }; Returns: boolean
                           },
"can_edit_synced_block":
{ Args: { "p_synced_block": string }; Returns: boolean
                           },
"can_in_space":
{ Args: { "capability": string,"space_id": string }; Returns: boolean
                           },
"can_manage_decision":
{ Args: { "p_decision": string }; Returns: boolean
                           },
"can_manage_goal":
{ Args: { "p_goal": string }; Returns: boolean
                           },
"can_manage_meeting":
{ Args: { "p_meeting": string }; Returns: boolean
                           },
"can_object_content":
{ Args: { "p_capability": string,"p_object": string,"p_type": string }; Returns: boolean
                           },
"can_page":
{ Args: { "capability": string,"page_id": string }; Returns: boolean
                           },
"can_post_comment":
{ Args: { "p_id": string,"p_type": string }; Returns: boolean
                           },
"can_react_to_comment":
{ Args: { "p_comment": string }; Returns: boolean
                           },
"can_read_comment_parent":
{ Args: { "p_id": string,"p_type": string }; Returns: boolean
                           },
"can_use_app":
{ Args: { "p_app": string,"p_capability": string }; Returns: boolean
                           },
"clear_org_vms_ids":
{ Args: { "p_org": string }; Returns: undefined
                           },
"close_project_with_evidence":
{ Args: { "p_archive_open_tasks": boolean,"p_closure": Json,"p_document_ids": (string)[],"p_project": string,"p_update": Json }; Returns: string
                           },
"comment_on_approval":
{ Args: { "p_item": string,"p_note": string }; Returns: string
                           },
"complete_meeting":
{ Args: { "p_meeting": string,"p_summary": string }; Returns: string
                           },
"contact_data_export":
{ Args: { "p_contact": string,"p_organization": string }; Returns: Json
                           },
"count_export_download":
{ Args: { "p_export_id": string }; Returns: number
                           },
"create_meeting_action":
{ Args: { "p_due"?: string,"p_meeting": string,"p_owner": string,"p_title": string }; Returns: string
                           },
"create_meeting_series":
{ Args: { "p_agenda": Json,"p_attendees": Json,"p_meetings": Json }; Returns: undefined
                           },
"create_native_relation_property":
{ Args: { "p_direction": string,"p_key": string,"p_name_en": string,"p_name_fr": string,"p_relation_type_key": string,"p_target_type_key": string,"p_type": string }; Returns: string
                           },
"create_notifications":
{ Args: { "p_rows": Json }; Returns: number
                           },
"create_program_with_channel":
{ Args: { "p_channel_name": string,"p_channel_purpose": string,"p_program": Json,"p_slug_base": string }; Returns: string
                           },
"create_project_with_channel":
{ Args: { "p_channel_name": string,"p_channel_purpose": string,"p_project": Json,"p_slug_base": string }; Returns: string
                           },
"create_rollup_property":
{ Args: { "p_function": string,"p_key": string,"p_name_en": string,"p_name_fr": string,"p_relation_property": string,"p_target_property": string,"p_type": string }; Returns: string
                           },
"create_team_with_channel":
{ Args: { "p_description"?: string,"p_name": string,"p_owner_id"?: string }; Returns: string
                           },
"create_two_way_relation":
{ Args: { "p_cardinality"?: string,"p_from_type": string,"p_key": string,"p_name_en": string,"p_name_fr": string,"p_reverse_key": string,"p_reverse_name_en": string,"p_reverse_name_fr": string,"p_to_type": string }; Returns: string
                           },
"crm_records_owned_by_former_staff":
{ Args: Record<PropertyKey, never>; Returns: {
              "owner_id": string,"owner_name": string,"record_id": string,"record_name": string,"record_type": string
            }[]
                           },
"current_actor_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"dashboard_program_task_counts":
{ Args: { "p_program_ids": (string)[] }; Returns: {
              "completed": number,"program_id": string,"total": number
            }[]
                           },
"dashboard_task_summary":
{ Args: { "p_month_ago": string,"p_sixty_days_ago": string,"p_today": string,"p_week_out": string }; Returns: {
              "completed_at_since_sixty_days": (string)[],"completed_last_30": number,"donut_in_progress": number,"donut_to_do": number,"due_this_week": number,"open_tasks": number,"overdue": number
            }[]
                           },
"decide_approval":
{ Args: { "p_decision": string,"p_item": string,"p_note"?: string }; Returns: string
                           },
"decide_report_version":
{ Args: { "p_decision": Database["public"]['Enums']["report_decision"],"p_note"?: string,"p_version_id": string }; Returns: string
                           },
"decide_suggestion":
{ Args: { "p_decision": string,"p_suggestion": string }; Returns: {
              "author_id": string,
"block_id": string,
"created_at": string,
"decided_at": string | null,
"decided_by": string | null,
"end_offset": number,
"id": string,
"object_id": string,
"object_type": string,
"organization_id": string,
"original_text": string,
"proposed_text": string,
"start_offset": number,
"status": string
            }
                          SetofOptions: {
        from: "*"
        to: "object_suggestion"
        isOneToOne: true
        isSetofReturn: false
      } },
"decide_workflow_review":
{ Args: { "p_comment"?: string,"p_decision": string,"p_review": string }; Returns: undefined
                           },
"decision_readable_by":
{ Args: { "p_decision": string,"p_user": string }; Returns: boolean
                           },
"document_acknowledgement_status":
{ Args: { "p_document": string }; Returns: {
              "acknowledged_at": string,"full_name": string,"role": string,"user_id": string
            }[]
                           },
"document_is_servable":
{ Args: { "p_document": string }; Returns: boolean
                           },
"document_upload_discardable":
{ Args: { "p_name": string }; Returns: boolean
                           },
"duplicate_template_v2":
{ Args: { "p_organization"?: string,"p_template": string }; Returns: string
                           },
"email_orphaned_notifications":
{ Args: { "p_limit"?: number,"p_older_than_minutes"?: number }; Returns: {
              "category": string,"dedupe_key": string,"notification_id": string,"urgency": string,"user_id": string
            }[]
                           },
"end_approval_delegation":
{ Args: { "p_delegation": string }; Returns: undefined
                           },
"erase_crm_contact":
{ Args: { "p_contact": string }; Returns: undefined
                           },
"expire_unfinished_uploads":
{ Args: { "p_apply": boolean,"p_before": string,"p_limit": number }; Returns: number
                           },
"fan_out_announcement":
{ Args: { "p_announcement": string,"p_rows": Json }; Returns: number
                           },
"finance_aging":
{ Args: { "p_as_of": string,"p_kind": string,"p_organization": string }; Returns: {
              "bucket": string,"contact_id": string,"contact_name": string,"control_account_id": string,"days_past_due": number,"document_date": string,"document_id": string,"due_date": string,"open_cents": number,"reference": string,"total_cents": number
            }[]
                           },
"finance_bill_approval_status":
{ Args: { "p_bill": string }; Returns: string
                           },
"finance_delete_draft":
{ Args: { "p_id": string,"p_kind": string }; Returns: undefined
                           },
"finance_post_bill":
{ Args: { "p_bill": string }; Returns: string
                           },
"finance_post_invoice":
{ Args: { "p_invoice": string }; Returns: string
                           },
"finance_posting_choices":
{ Args: { "p_organization": string }; Returns: {
              "account_type": string,"choice": string,"code": string,"id": string,"name": string
            }[]
                           },
"finance_record_payment":
{ Args: { "p_amount_cents": number,"p_bank_account": string,"p_document": string,"p_kind": string,"p_method": string,"p_paid_on": string,"p_reference"?: string }; Returns: string
                           },
"finance_request_bill_approval":
{ Args: { "p_bill": string }; Returns: string
                           },
"finance_reverse_payment":
{ Args: { "p_date": string,"p_payment": string,"p_reason"?: string }; Returns: string
                           },
"finance_save_bill":
{ Args: { "p_bill": string,"p_header": Json,"p_lines": Json,"p_organization": string }; Returns: string
                           },
"finance_save_invoice":
{ Args: { "p_header": Json,"p_invoice": string,"p_lines": Json,"p_organization": string }; Returns: string
                           },
"finance_set_bill_approval_threshold":
{ Args: { "p_organization": string,"p_threshold_cents": number }; Returns: undefined
                           },
"finance_tax_registration":
{ Args: { "p_date": string,"p_organization": string }; Returns: {
              "gst_number": string,"gst_rate": number,"gst_registered": boolean,"qst_number": string,"qst_rate": number,"qst_registered": boolean
            }[]
                           },
"finance_void_document":
{ Args: { "p_date": string,"p_id": string,"p_kind": string,"p_reason": string }; Returns: string
                           },
"find":
{ Args: { "p_limit"?: number,"p_offset"?: number,"p_query": string,"p_space"?: string,"p_types"?: (string)[] }; Returns: {
              "href": string,"id": string,"rank": number,"result_type": string,"snippet": string,"space_id": string,"title": string,"total": number,"updated_at": string
            }[]
                           },
"find_all_words":
{ Args: { "p_folded": string,"p_words": (string)[] }; Returns: boolean
                           },
"find_fold":
{ Args: { "p_text": string }; Returns: string
                           },
"form_v2_keep_file_private":
{ Args: { "p_document_id": string }; Returns: undefined
                           },
"forms_v2_convert_legacy":
{ Args: { "p_organization_id": string }; Returns: number
                           },
"forms_v2_revert_legacy":
{ Args: { "p_organization_id": string }; Returns: number
                           },
"gift_donor_list":
{ Args: { "p_from": string,"p_organization": string,"p_purpose"?: string,"p_to": string }; Returns: {
              "donor_email": string,"donor_id": string,"donor_kind": string,"donor_name": string,"first_gift_on": string,"gift_count": number,"in_kind_count": number,"last_gift_on": string,"total_cents": number
            }[]
                           },
"gift_donor_list_all":
{ Args: { "p_from": string,"p_organization": string,"p_purpose"?: string,"p_to": string }; Returns: Json
                           },
"gift_donor_statement":
{ Args: { "p_contact": string,"p_crm_organization": string,"p_organization": string,"p_year": number }; Returns: {
              "amount_cents": number,"fund_name": string,"fund_restriction": string,"gift_id": string,"gift_number": number,"gift_type": string,"in_kind_description": string,"program_name": string,"received_on": string,"value_supplied_by_donor": boolean
            }[]
                           },
"gift_record":
{ Args: { "p_gift": Json,"p_organization": string }; Returns: string
                           },
"gift_void":
{ Args: { "p_date": string,"p_gift": string,"p_reason": string }; Returns: undefined
                           },
"gift_year_total":
{ Args: { "p_organization": string,"p_year": number }; Returns: {
              "gift_count": number,"total_cents": number
            }[]
                           },
"global_search":
{ Args: { "p_limit"?: number,"p_query": string }; Returns: {
              "href": string,"id": string,"result_type": string,"snippet": string,"title": string
            }[]
                           },
"goal_progress_inputs":
{ Args: { "p_goal": string }; Returns: {
              "kind": string,"label": string,"metric_baseline": number,"metric_direction": string,"metric_latest": number,"metric_latest_on": string,"metric_target": number,"project_completed": boolean,"ref_id": string,"tasks_done": number,"tasks_total": number
            }[]
                           },
"google_link_event_meeting":
{ Args: { "p_link_id": string,"p_meeting_id": string }; Returns: undefined
                           },
"grant_write_allowance":
{ Args: { "p_action": string,"p_count": number,"p_seconds": number,"p_user": string }; Returns: undefined
                           },
"has_program_capability":
{ Args: { "p_capability": string,"p_program": string }; Returns: boolean
                           },
"has_project_capability":
{ Args: { "p_capability": string,"p_project": string }; Returns: boolean
                           },
"has_task_capability":
{ Args: { "p_capability": string,"p_task": string }; Returns: boolean
                           },
"hidden_property_keys":
{ Args: { "type_key": string }; Returns: (string)[]
                           },
"home_away_since":
{ Args: { "p_organization": string }; Returns: string
                           },
"insight_apply_schedule_shift":
{ Args: { "p_milestones": Json,"p_tasks": Json }; Returns: number
                           },
"invitation_preview":
{ Args: { "p_token": string }; Returns: {
              "email": string,"expires_at": string,"intended_role": Database["public"]['Enums']["org_role"],"organization_name": string
            }[]
                           },
"is_object_locked":
{ Args: { "p_object": string }; Returns: boolean
                           },
"job_health_summary":
{ Args: Record<PropertyKey, never>; Returns: {
              "failures_24h": number,"job_name": string,"last_duration_ms": number,"last_error": string,"last_failed_count": number,"last_finished_at": string,"last_metadata": Json,"last_processed_count": number,"last_run_id": string,"last_started_at": string,"last_status": string
            }[]
                           },
"job_queue_archive":
{ Args: { "p_msg_id": number,"p_queue": string }; Returns: boolean
                           },
"job_queue_dead_letters":
{ Args: { "p_limit"?: number }; Returns: {
              "archived_at": string,"enqueued_at": string,"message": Json,"msg_id": number,"queue_name": string,"read_ct": number
            }[]
                           },
"job_queue_delete":
{ Args: { "p_msg_id": number,"p_queue": string }; Returns: boolean
                           },
"job_queue_health":
{ Args: Record<PropertyKey, never>; Returns: {
              "archived_count": number,"oldest_message_age_seconds": number,"queue_length": number,"queue_name": string,"total_messages": number,"visible_length": number
            }[]
                           },
"job_queue_read":
{ Args: { "p_quantity"?: number,"p_queue": string,"p_visibility_seconds"?: number }; Returns: {
              "enqueued_at": string,"message": Json,"msg_id": number,"read_ct": number,"vt": string
            }[]
                           },
"job_queue_send":
{ Args: { "p_delay_seconds"?: number,"p_message": Json,"p_queue": string }; Returns: number
                           },
"job_runner_status":
{ Args: { "p_app_secret": string,"p_site_origin": string }; Returns: string
                           },
"join_channel":
{ Args: { "p_channel_id": string }; Returns: boolean
                           },
"leave_channel":
{ Args: { "p_channel_id": string }; Returns: boolean
                           },
"leave_presence":
{ Args: { "p_object": string }; Returns: undefined
                           },
"ledger_close_fiscal_year":
{ Args: { "p_organization": string,"p_starts_on": string }; Returns: string
                           },
"ledger_create_fiscal_year":
{ Args: { "p_organization": string,"p_starts_on": string }; Returns: number
                           },
"ledger_delete_draft":
{ Args: { "p_entry": string }; Returns: undefined
                           },
"ledger_entry_approvals":
{ Args: { "p_entry": string }; Returns: {
              "actor_name": string,"item_amount_cents": number,"item_created_at": string,"item_id": string,"item_status": string,"item_title": string,"kind": string,"note": string,"occurred_at": string,"step": number,"step_label": string
            }[]
                           },
"ledger_entry_trail":
{ Args: { "p_entry": string }; Returns: {
              "action": string,"actor_name": string,"metadata": Json,"occurred_at": string
            }[]
                           },
"ledger_export_lines":
{ Args: { "p_from": string,"p_organization": string,"p_to": string }; Returns: {
              "account_code": string,"account_name": string,"account_type": string,"credit_cents": number,"debit_cents": number,"description": string,"entry_date": string,"entry_id": string,"entry_kind": string,"entry_number": number,"fund_code": string,"fund_name": string,"line_no": number,"memo": string,"program_name": string,"project_name": string,"source_id": string,"source_type": string
            }[]
                           },
"ledger_fund_available_cents":
{ Args: { "p_as_of": string,"p_fund": string }; Returns: number
                           },
"ledger_fund_balances":
{ Args: { "p_as_of": string,"p_organization": string }; Returns: {
              "assets_cents": number,"code": string,"fund_balance_cents": number,"fund_id": string,"liabilities_cents": number,"name": string,"restriction": string
            }[]
                           },
"ledger_fund_changes":
{ Args: { "p_from": string,"p_organization": string,"p_to": string }; Returns: {
              "closing_cents": number,"code": string,"expenses_cents": number,"fund_id": string,"is_active": boolean,"name": string,"opening_cents": number,"restriction": string,"revenue_cents": number,"transfers_cents": number
            }[]
                           },
"ledger_funds_available_cents":
{ Args: { "p_as_of": string,"p_funds": (string)[] }; Returns: {
              "available_cents": number,"fund_id": string
            }[]
                           },
"ledger_general_ledger":
{ Args: { "p_account"?: string,"p_from": string,"p_fund"?: string,"p_organization": string,"p_to": string }; Returns: {
              "account_code": string,"account_id": string,"account_name": string,"credit_cents": number,"debit_cents": number,"entry_date": string,"entry_id": string,"entry_number": number,"fund_code": string,"line_description": string,"line_id": string,"memo": string,"opening_cents": number,"running_cents": number
            }[]
                           },
"ledger_grant_accountant":
{ Args: { "p_expires_on": string,"p_note"?: string,"p_organization": string,"p_user": string }; Returns: string
                           },
"ledger_note_accountant_session":
{ Args: { "p_organization": string }; Returns: boolean
                           },
"ledger_post_entry":
{ Args: { "p_entry": string }; Returns: number
                           },
"ledger_record_chart_approval":
{ Args: { "p_approved_by_name": string,"p_approved_on": string,"p_organization": string }; Returns: undefined
                           },
"ledger_release_restricted":
{ Args: { "p_amount_cents": number,"p_condition": string,"p_from_fund": string,"p_organization": string,"p_release_date": string,"p_to_fund": string }; Returns: string
                           },
"ledger_reopen_fiscal_year":
{ Args: { "p_organization": string,"p_reason": string,"p_starts_on": string }; Returns: string
                           },
"ledger_reverse_entry":
{ Args: { "p_entry": string,"p_entry_date": string,"p_memo": string }; Returns: string
                           },
"ledger_revoke_accountant":
{ Args: { "p_grant": string }; Returns: undefined
                           },
"ledger_save_draft":
{ Args: { "p_entry": string,"p_entry_date": string,"p_kind": string,"p_lines": Json,"p_memo": string,"p_organization": string }; Returns: string
                           },
"ledger_set_period_status":
{ Args: { "p_period": string,"p_status": string }; Returns: undefined
                           },
"ledger_statement_totals":
{ Args: { "p_from": string,"p_organization": string,"p_to": string }; Returns: {
              "account_id": string,"account_type": string,"balance_cents": number,"closing_movement_cents": number,"code": string,"fund_code": string,"fund_id": string,"fund_name": string,"movement_cents": number,"name": string,"opening_cents": number,"restriction": string
            }[]
                           },
"ledger_trial_balance":
{ Args: { "p_as_of": string,"p_fund"?: string,"p_organization": string }; Returns: {
              "account_id": string,"account_type": string,"balance_cents": number,"code": string,"credit_cents": number,"debit_cents": number,"name": string
            }[]
                           },
"lens__column":
{ Args: { "p_alias": string,"p_property": Json }; Returns: string
                           },
"lens__condition":
{ Args: { "aliases": number,"conditions": number,"p_alias": string,"p_allow_match": boolean,"p_depth": number,"p_node": Json,"p_today": string,"p_type_def": Json,"params": Json }; Returns: Record<string, unknown>
                           },
"lens__day_range":
{ Args: { "p_today": string,"p_value": Json }; Returns: Record<string, unknown>
                           },
"lens__display":
{ Args: { "p_id_expr": string,"p_property": Json }; Returns: string
                           },
"lens__fail":
{ Args: { "p_code": string,"p_message": string }; Returns: undefined
                           },
"lens__group":
{ Args: { "aliases": number,"conditions": number,"p_alias": string,"p_allow_match": boolean,"p_depth": number,"p_node": Json,"p_today": string,"p_type_def": Json,"params": Json }; Returns: Record<string, unknown>
                           },
"lens__list_ref":
{ Args: { "p_cast": string,"p_index": number }; Returns: string
                           },
"lens__only_keys":
{ Args: { "p_allowed": (string)[],"p_value": Json }; Returns: undefined
                           },
"lens__property":
{ Args: { "p_key": Json,"p_type_def": Json }; Returns: Json
                           },
"lens__ref":
{ Args: { "p_cast": string,"p_index": number }; Returns: string
                           },
"lens__type":
{ Args: { "p_type": Json }; Returns: Json
                           },
"lens__via_exists":
{ Args: { "p_alias": string,"p_person_ref": string,"p_property": Json }; Returns: string
                           },
"lens__visible_id":
{ Args: { "p_alias": string,"p_property": Json }; Returns: string
                           },
"lens_aggregate":
{ Args: { "measures": Json,"spec": Json,"time_zone"?: string }; Returns: Json
                           },
"lens_catalog":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"lens_compile":
{ Args: { "spec": Json,"time_zone"?: string }; Returns: Json
                           },
"lens_editable":
{ Args: { "p_ids": (string)[] }; Returns: string[]
                           },
"lens_query":
{ Args: { "spec": Json,"time_zone"?: string }; Returns: Json
                           },
"lens_shift_tasks":
{ Args: { "p_moves": Json }; Returns: number
                           },
"link_vms_identity":
{ Args: { "p_org": string,"p_user": string,"p_vms_id": string }; Returns: undefined
                           },
"lock_object":
{ Args: { "p_object": string,"p_reason"?: string }; Returns: undefined
                           },
"my_open_task_count":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"my_sign_in_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"my_spaces":
{ Args: Record<PropertyKey, never>; Returns: {
              "archived_at": string,"capabilities": (string)[],"description": string,"icon": string,"id": string,"kind": string,"name_en": string,"name_fr": string,"organization_id": string,"owner_id": string,"program_id": string
            }[]
                           },
"notification_reopen":
{ Args: { "p_row": Omit<Database["public"]['Tables']["notification"]['Row'], Database["public"]['Tables']["notification"]['ComputedFields']> }; Returns: undefined
                           },
"object_approvals":
{ Args: { "p_object_id": string,"p_object_type": string }; Returns: {
              "approval_item_id": string,"can_open": boolean,"current_step": number,"decided_at": string,"requested_at": string,"requested_by_name": string,"status": string,"step_label": string,"title": string
            }[]
                           },
"object_capabilities":
{ Args: { "object_id": string }; Returns: (string)[]
                           },
"object_event_high_water":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"open_task_workload":
{ Args: { "p_today": string,"p_week_out": string }; Returns: {
              "active": number,"assignee_id": string,"assignee_name": string,"due_soon": number,"estimated_hours": number,"near_term_hours": number,"near_term_known": number,"near_term_unknown": number,"overdue": number,"unknown_estimates": number
            }[]
                           },
"ops_health_snapshot":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"page_presence_leave":
{ Args: { "p_page": string,"p_tab": string }; Returns: undefined
                           },
"page_presence_list":
{ Args: { "p_page": string }; Returns: {
              "editing": boolean,"full_name": string,"updated_at": string,"user_id": string
            }[]
                           },
"page_presence_touch":
{ Args: { "p_editing"?: boolean,"p_page": string,"p_tab": string }; Returns: undefined
                           },
"payroll_delete_draft":
{ Args: { "p_run": string }; Returns: undefined
                           },
"payroll_import_runs":
{ Args: { "p_file_name": string,"p_file_sha256": string,"p_organization": string,"p_provider": string,"p_runs": Json }; Returns: Json
                           },
"payroll_post_run":
{ Args: { "p_run": string }; Returns: number
                           },
"payroll_reverse_run":
{ Args: { "p_entry_date": string,"p_memo": string,"p_run": string }; Returns: string
                           },
"payroll_run_lines":
{ Args: { "p_run": string }; Returns: {
              "account_id": string,"category": string,"credit_cents": number,"debit_cents": number,"description": string,"fund_id": string,"line_no": number,"program_id": string
            }[]
                           },
"payroll_save_account_map":
{ Args: { "p_map": Json,"p_organization": string }; Returns: undefined
                           },
"payroll_save_allocation":
{ Args: { "p_allocation": Json,"p_run": string }; Returns: undefined
                           },
"person_data_export":
{ Args: { "p_organization": string,"p_subject": string }; Returns: Json
                           },
"person_work_summary":
{ Args: { "p_activity_before"?: string,"p_activity_limit"?: number,"p_today": string,"p_user_id": string }; Returns: Json
                           },
"portfolio_project_progress":
{ Args: { "p_member"?: string,"p_project_ids": (string)[] }; Returns: {
              "blocked_task_title": string,"completed": number,"member_has_task": boolean,"project_id": string,"total": number
            }[]
                           },
"project_task_counts":
{ Args: { "p_project": string }; Returns: {
              "completed": number,"open": number,"total": number
            }[]
                           },
"public_pages_enabled":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"publication_candidates":
{ Args: { "object_id": string }; Returns: Json
                           },
"publication_preview":
{ Args: { "publication_id": string }; Returns: Json
                           },
"publication_request":
{ Args: { "fields": (string)[],"object_id": string,"slug": string }; Returns: string
                           },
"publication_review":
{ Args: { "approve": boolean,"note"?: string,"publication_id": string }; Returns: undefined
                           },
"publication_unpublish":
{ Args: { "publication_id": string }; Returns: undefined
                           },
"published_object_ids":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"purge_quarantined_file":
{ Args: { "p_id": string,"p_kind": string }; Returns: {
              "bucket": string,"storage_path": string
            }[]
                           },
"rate_limit_hit":
{ Args: { "p_bucket": string,"p_limit": number,"p_window_seconds": number }; Returns: {
              "allowed": boolean,"reset_at": string,"used": number
            }[]
                           },
"record_change_set":
{ Args: { "p_action_key": string,"p_changes": Json,"p_organization"?: string,"p_since_seq"?: number,"p_undo_of"?: string }; Returns: {
              "action_key": string,
"actor_id": string | null,
"actor_kind": string,
"created_at": string,
"id": string,
"organization_id": string,
"undo_of": string | null,
"undone_at": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "change_set"
        isOneToOne: true
        isSetofReturn: false
      } },
"record_change_set_as":
{ Args: { "p_action_key": string,"p_actor": string,"p_assurance"?: string,"p_changes": Json,"p_organization"?: string,"p_since_seq"?: number,"p_undo_of"?: string,"p_user": string }; Returns: {
              "action_key": string,
"actor_id": string | null,
"actor_kind": string,
"created_at": string,
"id": string,
"organization_id": string,
"undo_of": string | null,
"undone_at": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "change_set"
        isOneToOne: true
        isSetofReturn: false
      } },
"record_report_version":
{ Args: { "p_note"?: string,"p_report_id": string,"p_snapshot": Json }; Returns: string
                           },
"record_retention_register":
{ Args: { "p_organization": string }; Returns: {
              "category_key": string,"held": boolean,"past_retention": boolean,"record_date": string,"record_id": string,"record_type": string,"retain_until": string,"title": string
            }[]
                           },
"rectify_member_profile":
{ Args: { "p_full_name": string,"p_org": string,"p_title": string,"p_user": string }; Returns: undefined
                           },
"release_quarantined_file":
{ Args: { "p_id": string,"p_kind": string,"p_reason": string }; Returns: undefined
                           },
"release_scheduled_announcement":
{ Args: { "p_announcement": string }; Returns: string
                           },
"remove_program_direct_access":
{ Args: { "p_program": string,"p_user": string }; Returns: string
                           },
"remove_project_direct_access":
{ Args: { "p_project": string,"p_user": string }; Returns: string
                           },
"remove_team_member":
{ Args: { "p_team_id": string,"p_user_id": string }; Returns: boolean
                           },
"request_object_approval":
{ Args: { "p_note"?: string,"p_object_id": string,"p_object_type": string,"p_title"?: string }; Returns: string
                           },
"requeue_failed_email_deliveries":
{ Args: { "p_organization": string }; Returns: number
                           },
"restore_object":
{ Args: { "p_object": string }; Returns: string
                           },
"revoke_api_token":
{ Args: { "p_token": string }; Returns: undefined
                           },
"role_visibility_report":
{ Args: { "role": Database["public"]['Enums']["org_role"] }; Returns: Json
                           },
"sales_tax_close_period":
{ Args: { "p_fund"?: string,"p_period": string }; Returns: string
                           },
"sales_tax_create_period":
{ Args: { "p_ends_on": string,"p_organization": string,"p_starts_on": string }; Returns: string
                           },
"sales_tax_delete_line":
{ Args: { "p_line": string }; Returns: undefined
                           },
"sales_tax_import_receipts":
{ Args: { "p_from": string,"p_organization": string,"p_to": string }; Returns: number
                           },
"sales_tax_reopen_period":
{ Args: { "p_period": string,"p_reversal_date": string }; Returns: undefined
                           },
"sales_tax_save_line":
{ Args: { "p_amount_cents": number,"p_counterparty": string,"p_description": string,"p_direction": string,"p_gst_cents"?: number,"p_itc_cents"?: number,"p_itr_cents"?: number,"p_line": string,"p_organization": string,"p_qst_cents"?: number,"p_reference": string,"p_tax_code": string,"p_transaction_date": string }; Returns: string
                           },
"sales_tax_save_settings":
{ Args: { "p_filing_frequency": string,"p_gst_number": string,"p_gst_registered": boolean,"p_itc_claim_bp": number,"p_organization": string,"p_qst_number": string,"p_qst_registered": boolean,"p_show_psb_rebate": boolean }; Returns: undefined
                           },
"sales_tax_totals":
{ Args: { "p_from": string,"p_organization": string,"p_to": string }; Returns: {
              "amount_cents": number,"direction": string,"gst_cents": number,"itc_cents": number,"itr_cents": number,"line_count": number,"qst_cents": number,"tax_code": string
            }[]
                           },
"save_object_version":
{ Args: { "p_content": Json,"p_kind": string,"p_label"?: string,"p_object": string,"p_properties": Json,"p_type": string }; Returns: string
                           },
"search_library":
{ Args: { "p_include_archived"?: boolean,"p_include_receipts"?: boolean,"p_limit"?: number,"p_query": string }; Returns: {
              "created_at": string,"id": string,"is_current": boolean,"kind": string,"matched_inside": boolean,"rank": number,"receipt_date": string,"snippet": string,"title": string,"version_number": number
            }[]
                           },
"send_for_signature":
{ Args: { "p_file_name": string,"p_message": string,"p_organization_id": string,"p_signer_ids": (string)[],"p_storage_path": string,"p_title": string }; Returns: string
                           },
"set_approval_delegation":
{ Args: { "p_approver": string,"p_delegate": string,"p_ends_on": string,"p_note"?: string,"p_organization": string,"p_starts_on": string }; Returns: string
                           },
"set_comment_mentions":
{ Args: { "p_comment": string,"p_objects": (string)[],"p_people": (string)[] }; Returns: string[]
                           },
"set_document_text":
{ Args: { "p_document": string,"p_source": string,"p_text": string }; Returns: undefined
                           },
"set_operator_switch":
{ Args: { "p_enabled": boolean,"p_name": string }; Returns: undefined
                           },
"set_program_direct_access":
{ Args: { "p_program": string,"p_role": Database["public"]['Enums']["program_access_role"],"p_user": string }; Returns: string
                           },
"set_project_direct_access":
{ Args: { "p_project": string,"p_role": Database["public"]['Enums']["project_access_role"],"p_user": string }; Returns: string
                           },
"set_receipt_text":
{ Args: { "p_receipt": string,"p_source": string,"p_text": string }; Returns: undefined
                           },
"sidebar_state":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"signup_allowed":
{ Args: { "p_email": string }; Returns: boolean
                           },
"space_capabilities":
{ Args: { "space_id": string }; Returns: (string)[]
                           },
"store_integration_sync_state":
{ Args: { "p_connection": string,"p_state": Json }; Returns: undefined
                           },
"store_integration_tokens":
{ Args: { "p_access": string,"p_connection": string,"p_expires": string,"p_refresh": string }; Returns: undefined
                           },
"submit_approval":
{ Args: { "p_amount_cents"?: number,"p_description"?: string,"p_organization": string,"p_program_id"?: string,"p_subject_id"?: string,"p_subject_type": string,"p_title": string }; Returns: string
                           },
"submit_form":
{ Args: { "p_answers": Json,"p_consent"?: boolean,"p_form_id": string,"p_signer_name"?: string }; Returns: string
                           },
"submit_form_v2":
{ Args: { "p_answers": Json,"p_form_id": string }; Returns: {
              "object_id": string,"object_type": string,"response_id": string
            }[]
                           },
"sync_team_signals":
{ Args: { "p_organization_id": string,"p_today": string }; Returns: {
              "item_count": number,"kind": string,"oldest_overdue_days": number,"signal_id": string,"user_id": string
            }[]
                           },
"team_overview":
{ Args: { "p_today": string }; Returns: {
              "avatar_url": string,"blocked": number,"blocked_stale": number,"completed_30": number,"completed_7": number,"completed_prev_7": number,"due_this_week": number,"full_name": string,"in_progress_stale": number,"last_activity_at": string,"oldest_overdue_due": string,"open_decisions": number,"open_tasks": number,"organization_id": string,"overdue": number,"overdue_decisions": number,"role": string,"title": string,"user_id": string
            }[]
                           },
"team_signal_digest":
{ Args: { "p_organization_id": string,"p_today": string }; Returns: {
              "blocked_stale": number,"full_name": string,"in_progress_stale": number,"kinds": (string)[],"oldest_overdue_days": number,"overdue": number,"overdue_decisions": number,"role": string,"stale_projects": number,"user_id": string
            }[]
                           },
"template_v2_id_ok":
{ Args: { "p_id": string,"p_org": string }; Returns: boolean
                           },
"template_v2_ids_ok":
{ Args: { "p_org": string,"p_text": string }; Returns: boolean
                           },
"template_v2_scrub_blocks":
{ Args: { "p_blocks": Json,"p_org": string }; Returns: Json
                           },
"template_v2_scrub_inline":
{ Args: { "p": Json,"p_org": string }; Returns: Json
                           },
"template_v2_version_pages":
{ Args: { "p_template": string }; Returns: {
              "pages": number,"version": number
            }[]
                           },
"touch_presence":
{ Args: { "p_cursor"?: Json,"p_editing"?: boolean,"p_object": string }; Returns: undefined
                           },
"transfer_organization_ownership":
{ Args: { "p_target_membership": string }; Returns: undefined
                           },
"transfer_team_ownership":
{ Args: { "p_target_user_id": string,"p_team_id": string }; Returns: boolean
                           },
"trash_object":
{ Args: { "p_object": string,"p_title": string,"p_type": string }; Returns: string
                           },
"unlock_object":
{ Args: { "p_object": string }; Returns: undefined
                           },
"unregistered_uploads":
{ Args: { "p_before": string,"p_limit": number }; Returns: {
              "bucket_id": string,"name": string
            }[]
                           },
"unregistered_uploads_summary":
{ Args: { "p_before": string }; Returns: {
              "bucket_id": string,"bytes": number,"files": number,"oldest": string
            }[]
                           },
"upkeep_broken_links":
{ Args: Record<PropertyKey, never>; Returns: {
              "detail": string,"issue": string,"object_id": string,"object_type": string,"title": string
            }[]
                           },
"upkeep_duplicates":
{ Args: Record<PropertyKey, never>; Returns: {
              "match_key": string,"object_ids": (string)[],"object_type": string,"titles": (string)[]
            }[]
                           },
"upkeep_normalize":
{ Args: { "p_text": string }; Returns: string
                           },
"upkeep_orphans":
{ Args: { "p_days"?: number }; Returns: {
              "created_at": string,"detail": string,"object_id": string,"object_type": string,"title": string
            }[]
                           },
"upkeep_stale_pages":
{ Args: { "p_days"?: number }; Returns: {
              "days_idle": number,"last_touched": string,"object_id": string,"object_type": string,"owner_id": string,"owner_name": string,"title": string
            }[]
                           },
"upkeep_unused":
{ Args: Record<PropertyKey, never>; Returns: {
              "detail": string,"issue": string,"object_id": string,"title": string
            }[]
                           },
"verify_form_submission":
{ Args: { "p_submission_id": string }; Returns: {
              "matches": boolean,"recomputed_sha256": string,"recorded_sha256": string
            }[]
                           },
"withdraw_approval":
{ Args: { "p_item": string,"p_note"?: string }; Returns: string
                           },
"workflow_submit_approval":
{ Args: { "p_description"?: string,"p_organization": string,"p_subject_type": string,"p_title": string,"p_user": string }; Returns: string
                           },
"workspace_app_set_published":
{ Args: { "p_app": string,"p_published": boolean }; Returns: undefined
                           },
"workspace_bootstrap_open":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"zeffy_contacts_by_email":
{ Args: { "p_emails": (string)[],"p_organization": string }; Returns: {
              "email": string,"id": string,"zeffy_contact_id": string
            }[]
                           },
"zeffy_overview":
{ Args: { "p_from": string,"p_organization": string,"p_to": string }; Returns: Json
                           },
"zeffy_refresh_supporter_kinds":
{ Args: { "p_organization": string,"p_zeffy_contact_ids": (string)[] }; Returns: number
                           },
"zeffy_resolve_match":
{ Args: { "p_contact"?: string,"p_match": string }; Returns: string
                           },
"zeffy_supporter_activity":
{ Args: { "p_contact": string }; Returns: {
              "amount_cents": number,"campaign_category": string,"campaign_title": string,"currency": string,"dispute_status": string,"is_recurring": boolean,"item_kinds": (string)[],"paid_at": string,"receipt_url": string,"recurring_interval": string,"refund_status": string,"refunded_cents": number,"status": string,"zeffy_id": string
            }[]
                           },
"zeffy_supporter_totals":
{ Args: { "p_contact"?: string,"p_organization": string,"p_purpose"?: string }; Returns: {
              "contact_id": string,"currency": string,"email": string,"first_paid_at": string,"full_name": string,"last_amount_cents": number,"last_paid_at": string,"net_cents": number,"payment_count": number,"recurring_active": boolean,"this_year_cents": number
            }[]
                           }
          }
          Enums: {
            "agenda_kind": "information"|"discussion"|"decision","announcement_priority": "normal"|"important"|"critical","approval_decision": "pending"|"approved"|"rejected"|"withdrawn","channel_access_source": "direct"|"mandatory"|"team"|"program"|"project"|"event"|"legacy","channel_privacy": "public"|"private","channel_type": "organization"|"announcements"|"team"|"program"|"project"|"event"|"operations"|"leadership"|"custom","document_kind": "file"|"link","event_status": "planning"|"confirmed"|"in_progress"|"completed"|"cancelled","export_kind": "organization_data"|"person_data"|"crm_contacts"|"task_history"|"report_bundle"|"contact_data","export_status": "queued"|"running"|"ready"|"failed"|"expired","follow_up_status": "open"|"done"|"cancelled","interaction_type": "meeting"|"call"|"email"|"message"|"note"|"other","issue_severity": "low"|"medium"|"high"|"critical","issue_status": "open"|"investigating"|"resolved"|"closed","meeting_status": "scheduled"|"in_progress"|"completed"|"cancelled","membership_status": "active"|"invited"|"deactivated","metric_direction": "increase"|"decrease","notification_urgency": "low"|"normal"|"high"|"critical","operation_status": "planned"|"delivered"|"cancelled","opportunity_kind": "grant"|"sponsorship"|"contract"|"donation"|"partnership"|"in_kind","opportunity_stage": "identified"|"qualifying"|"preparing"|"submitted"|"awarded"|"declined"|"withdrawn","org_role": "owner"|"admin"|"leadership_viewer"|"staff"|"volunteer"|"guest","posting_policy": "everyone"|"staff"|"admins","program_access_role": "lead"|"manager"|"contributor"|"reviewer"|"follower"|"read_only","program_status": "active"|"paused"|"archived","project_access_role": "project_manager"|"contributor"|"reviewer"|"approver"|"follower"|"read_only","project_health": "on_track"|"at_risk"|"off_track"|"paused"|"unknown","project_request_status": "submitted"|"in_review"|"approved"|"declined"|"withdrawn"|"deferred"|"returned","project_stage": "proposed"|"approved"|"planning"|"active"|"paused"|"completed"|"cancelled"|"archived","reply_policy": "normal"|"threads_only"|"disabled","report_decision": "approved"|"rejected","report_status": "draft"|"in_review"|"approved","retention_action": "delete"|"anonymise","risk_impact": "low"|"medium"|"high","risk_likelihood": "low"|"medium"|"high","risk_status": "open"|"mitigating"|"accepted"|"closed","scoped_grant_source": "direct"|"legacy_membership"|"program_inherited"|"team"|"record_owner"|"record_lead","task_priority": "low"|"medium"|"high"|"critical","task_status": "not_started"|"ready"|"in_progress"|"waiting"|"blocked"|"in_review"|"completed"|"cancelled"
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
            "agenda_kind": ["information", "discussion", "decision"],"announcement_priority": ["normal", "important", "critical"],"approval_decision": ["pending", "approved", "rejected", "withdrawn"],"channel_access_source": ["direct", "mandatory", "team", "program", "project", "event", "legacy"],"channel_privacy": ["public", "private"],"channel_type": ["organization", "announcements", "team", "program", "project", "event", "operations", "leadership", "custom"],"document_kind": ["file", "link"],"event_status": ["planning", "confirmed", "in_progress", "completed", "cancelled"],"export_kind": ["organization_data", "person_data", "crm_contacts", "task_history", "report_bundle", "contact_data"],"export_status": ["queued", "running", "ready", "failed", "expired"],"follow_up_status": ["open", "done", "cancelled"],"interaction_type": ["meeting", "call", "email", "message", "note", "other"],"issue_severity": ["low", "medium", "high", "critical"],"issue_status": ["open", "investigating", "resolved", "closed"],"meeting_status": ["scheduled", "in_progress", "completed", "cancelled"],"membership_status": ["active", "invited", "deactivated"],"metric_direction": ["increase", "decrease"],"notification_urgency": ["low", "normal", "high", "critical"],"operation_status": ["planned", "delivered", "cancelled"],"opportunity_kind": ["grant", "sponsorship", "contract", "donation", "partnership", "in_kind"],"opportunity_stage": ["identified", "qualifying", "preparing", "submitted", "awarded", "declined", "withdrawn"],"org_role": ["owner", "admin", "leadership_viewer", "staff", "volunteer", "guest"],"posting_policy": ["everyone", "staff", "admins"],"program_access_role": ["lead", "manager", "contributor", "reviewer", "follower", "read_only"],"program_status": ["active", "paused", "archived"],"project_access_role": ["project_manager", "contributor", "reviewer", "approver", "follower", "read_only"],"project_health": ["on_track", "at_risk", "off_track", "paused", "unknown"],"project_request_status": ["submitted", "in_review", "approved", "declined", "withdrawn", "deferred", "returned"],"project_stage": ["proposed", "approved", "planning", "active", "paused", "completed", "cancelled", "archived"],"reply_policy": ["normal", "threads_only", "disabled"],"report_decision": ["approved", "rejected"],"report_status": ["draft", "in_review", "approved"],"retention_action": ["delete", "anonymise"],"risk_impact": ["low", "medium", "high"],"risk_likelihood": ["low", "medium", "high"],"risk_status": ["open", "mitigating", "accepted", "closed"],"scoped_grant_source": ["direct", "legacy_membership", "program_inherited", "team", "record_owner", "record_lead"],"task_priority": ["low", "medium", "high", "critical"],"task_status": ["not_started", "ready", "in_progress", "waiting", "blocked", "in_review", "completed", "cancelled"]
          }
        }
} as const
