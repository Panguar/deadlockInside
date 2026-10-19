export interface paths {
    "/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Live */
        get: operations["live_health_live_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Ready */
        get: operations["ready_health_ready_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/players/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search Players */
        get: operations["search_players_api_v1_players_search_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/players/{account_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read Player */
        get: operations["read_player_api_v1_players__account_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/players/{account_id}/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read Player Stats */
        get: operations["read_player_stats_api_v1_players__account_id__stats_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/players/{account_id}/matches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read Player Matches */
        get: operations["read_player_matches_api_v1_players__account_id__matches_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/players/{account_id}/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Refresh Player */
        post: operations["refresh_player_api_v1_players__account_id__refresh_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/matches/{match_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read Match */
        get: operations["read_match_api_v1_matches__match_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/refresh-jobs/{job_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read Job */
        get: operations["read_job_api_v1_refresh_jobs__job_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/heroes/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read Hero Stats */
        get: operations["read_hero_stats_api_v1_heroes_stats_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/heroes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read Heroes */
        get: operations["read_heroes_api_v1_heroes_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/heroes/{hero_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read Hero */
        get: operations["read_hero_api_v1_heroes__hero_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** ApiMeta */
        ApiMeta: {
            /** Source */
            source: string;
            /** Updated At */
            updated_at?: string | null;
            /**
             * Sample Size
             * @default 0
             */
            sample_size: number;
            /**
             * Coverage
             * @default unknown
             */
            coverage: string;
            /**
             * Stale
             * @default false
             */
            stale: boolean;
            /** Next Cursor */
            next_cursor?: string | null;
            /** Reused */
            reused?: boolean | null;
        };
        /** Envelope[HeroDetailOut] */
        Envelope_HeroDetailOut_: {
            data: components["schemas"]["HeroDetailOut"];
            meta: components["schemas"]["ApiMeta"];
        };
        /** Envelope[JobOut] */
        Envelope_JobOut_: {
            data: components["schemas"]["JobOut"];
            meta: components["schemas"]["ApiMeta"];
        };
        /** Envelope[PlayerOut] */
        Envelope_PlayerOut_: {
            data: components["schemas"]["PlayerOut"];
            meta: components["schemas"]["ApiMeta"];
        };
        /** Envelope[PlayerStatsOut] */
        Envelope_PlayerStatsOut_: {
            data: components["schemas"]["PlayerStatsOut"];
            meta: components["schemas"]["ApiMeta"];
        };
        /** Envelope[RefreshAccepted] */
        Envelope_RefreshAccepted_: {
            data: components["schemas"]["RefreshAccepted"];
            meta: components["schemas"]["ApiMeta"];
        };
        /** Envelope[Union[MatchOut, RefreshAccepted]] */
        Envelope_Union_MatchOut__RefreshAccepted__: {
            /** Data */
            data: components["schemas"]["MatchOut"] | components["schemas"]["RefreshAccepted"];
            meta: components["schemas"]["ApiMeta"];
        };
        /** Envelope[list[HeroGlobalStatsOut]] */
        Envelope_list_HeroGlobalStatsOut__: {
            /** Data */
            data: components["schemas"]["HeroGlobalStatsOut"][];
            meta: components["schemas"]["ApiMeta"];
        };
        /** Envelope[list[HeroOut]] */
        Envelope_list_HeroOut__: {
            /** Data */
            data: components["schemas"]["HeroOut"][];
            meta: components["schemas"]["ApiMeta"];
        };
        /** Envelope[list[MatchHistoryItem]] */
        Envelope_list_MatchHistoryItem__: {
            /** Data */
            data: components["schemas"]["MatchHistoryItem"][];
            meta: components["schemas"]["ApiMeta"];
        };
        /** Envelope[list[PlayerCandidateOut]] */
        Envelope_list_PlayerCandidateOut__: {
            /** Data */
            data: components["schemas"]["PlayerCandidateOut"][];
            meta: components["schemas"]["ApiMeta"];
        };
        /** ErrorDetail */
        ErrorDetail: {
            /** Code */
            code: string;
            /** Message */
            message: string;
            /** Request Id */
            request_id: string;
        };
        /** ErrorEnvelope */
        ErrorEnvelope: {
            error: components["schemas"]["ErrorDetail"];
        };
        /** HeroDetailOut */
        HeroDetailOut: {
            /** Hero Id */
            hero_id: string;
            /** Name */
            name: string;
            /** Class Name */
            class_name: string | null;
            /** Client Version */
            client_version: number | null;
            stats?: components["schemas"]["HeroGlobalStatsOut"] | null;
        };
        /** HeroGlobalStatsOut */
        HeroGlobalStatsOut: {
            /** Hero Id */
            hero_id: string;
            /** Name */
            name: string | null;
            /** Class Name */
            class_name?: string | null;
            /** Matches */
            matches: number | null;
            /** Wins */
            wins: number | null;
            /** Losses */
            losses: number | null;
            /** Win Rate */
            win_rate: number | null;
            /** Kda */
            kda: number | null;
            /** Kda Sample Size */
            kda_sample_size: number;
        };
        /** HeroOut */
        HeroOut: {
            /** Hero Id */
            hero_id: string;
            /** Name */
            name: string;
            /** Class Name */
            class_name: string | null;
            /** Client Version */
            client_version: number | null;
        };
        /** JobOut */
        JobOut: {
            /** Job Id */
            job_id: string;
            /** Status */
            status: string;
            /** Attempts */
            attempts: number;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Error Code */
            error_code?: string | null;
        };
        /** MatchHistoryItem */
        MatchHistoryItem: {
            /** Match Id */
            match_id: string;
            /**
             * Started At
             * Format: date-time
             */
            started_at: string;
            /** Duration S */
            duration_s: number | null;
            /** Hero Id */
            hero_id: string;
            /** Kills */
            kills: number | null;
            /** Deaths */
            deaths: number | null;
            /** Assists */
            assists: number | null;
            /** Net Worth */
            net_worth: number | null;
            /** Player Damage */
            player_damage: number | null;
            /** Player Match Outcome */
            player_match_outcome: number | null;
            /** Status */
            status: string;
        };
        /** MatchItemOut */
        MatchItemOut: {
            /** Item Id */
            item_id?: string | null;
        } & {
            [key: string]: unknown;
        };
        /** MatchOut */
        MatchOut: {
            /** Match Id */
            match_id: string;
            /**
             * Started At
             * Format: date-time
             */
            started_at: string;
            /** Duration S */
            duration_s: number | null;
            /** Game Mode */
            game_mode: number | null;
            /** Match Mode */
            match_mode: number | null;
            /** Winning Team */
            winning_team: number | null;
            /** Status */
            status: string;
            /** Players */
            players: components["schemas"]["MatchPlayerOut"][];
        };
        /** MatchPlayerOut */
        MatchPlayerOut: {
            /** Account Id */
            account_id: string;
            /** Personaname */
            personaname: string | null;
            /** Hero Id */
            hero_id: string;
            /** Hero Name */
            hero_name: string;
            /** Team */
            team: number | null;
            /** Kills */
            kills: number | null;
            /** Deaths */
            deaths: number | null;
            /** Assists */
            assists: number | null;
            /** Net Worth */
            net_worth: number | null;
            /** Player Damage */
            player_damage: number | null;
            /** Player Match Outcome */
            player_match_outcome: number | null;
            /** Items */
            items: components["schemas"]["MatchItemOut"][] | null;
        };
        /** PlayerCandidateOut */
        PlayerCandidateOut: {
            /** Account Id */
            account_id: string;
            /** Personaname */
            personaname: string;
            /** Avatar Url */
            avatar_url?: string | null;
        };
        /** PlayerHeroStatsOut */
        PlayerHeroStatsOut: {
            /** Hero Id */
            hero_id: string;
            /** Sample Size */
            sample_size: number;
            /** Decided Matches */
            decided_matches: number;
            /** Wins */
            wins: number;
            /** Win Rate */
            win_rate: number | null;
            /** Kda */
            kda: number | null;
            /** Kda Sample Size */
            kda_sample_size: number;
        };
        /** PlayerOut */
        PlayerOut: {
            /** Account Id */
            account_id: string;
            /** Personaname */
            personaname: string | null;
            /** Avatar Url */
            avatar_url?: string | null;
            /** Rank Badge */
            rank_badge?: number | null;
            /** Profile Updated At */
            profile_updated_at?: string | null;
        };
        /** PlayerStatsOut */
        PlayerStatsOut: {
            /** Sample Size */
            sample_size: number;
            /** Decided Matches */
            decided_matches: number;
            /** Wins */
            wins: number;
            /** Win Rate */
            win_rate: number | null;
            /** Kda */
            kda: number | null;
            /** Kda Sample Size */
            kda_sample_size: number;
            /** Heroes */
            heroes: components["schemas"]["PlayerHeroStatsOut"][];
        };
        /** RefreshAccepted */
        RefreshAccepted: {
            /** Job Id */
            job_id: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    live_health_live_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    ready_health_ready_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Dependencies unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    search_players_api_v1_players_search_get: {
        parameters: {
            query: {
                q: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope_list_PlayerCandidateOut__"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Too Many Requests */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    read_player_api_v1_players__account_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope_PlayerOut_"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    read_player_stats_api_v1_players__account_id__stats_get: {
        parameters: {
            query?: {
                hero_id?: number | null;
                from?: string | null;
                to?: string | null;
            };
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope_PlayerStatsOut_"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    read_player_matches_api_v1_players__account_id__matches_get: {
        parameters: {
            query?: {
                cursor?: string | null;
                limit?: number;
                hero_id?: number | null;
                from?: string | null;
                to?: string | null;
            };
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope_list_MatchHistoryItem__"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    refresh_player_api_v1_players__account_id__refresh_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope_RefreshAccepted_"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Too Many Requests */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    read_match_api_v1_matches__match_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                match_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope_Union_MatchOut__RefreshAccepted__"];
                };
            };
            /** @description Metadata loading queued */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    read_job_api_v1_refresh_jobs__job_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope_JobOut_"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    read_hero_stats_api_v1_heroes_stats_get: {
        parameters: {
            query?: {
                from?: string | null;
                to?: string | null;
                min_average_badge?: number | null;
                max_average_badge?: number | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope_list_HeroGlobalStatsOut__"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    read_heroes_api_v1_heroes_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope_list_HeroOut__"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    read_hero_api_v1_heroes__hero_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                hero_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Envelope_HeroDetailOut_"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
}
