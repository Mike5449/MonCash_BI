/* hand-written — Period Report (multi-KPI snapshot over a chosen window) */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';

export type GenderBlock = {
  TOTAL:   number
  FEMALE:  number
  MALE:    number
  UNKNOWN: number
}

export type PeriodReport = {
  period: { start: string, end: string }
  customers: {
    registered: GenderBlock
    active:     GenderBlock
    dormant:    GenderBlock
  }
  merchants: {
    registered: number
    active:     number
    dormant:    number
  }
  transactions: {
    volume:  number
    value:   number
    revenue: number
  }
}

// ── Channel × Category matrix ────────────────────────────────────────────────

export type MatrixCell = { volume: number, value: number }

export type MatrixCategory = {
  id:       string      // 'mobile' | 'card' | 'online' | 'total'
  label:    string      // 'Opération via téléphone mobile' etc.
  channels: string[]    // ['API', 'APP', 'QR'] or ['*'] for total
}

export type MatrixRow = {
  id:       string      // 'topup' | 'deposit' | ... | 'other'
  label:    string      // 'Recharge téléphonique' etc.
  tr_types: string[]    // ['SELF_TOPUP', 'TOPUP_GIFT']
  cells:    Record<string, MatrixCell>   // keyed by category id
}

export type ChannelCategoryMatrix = {
  period:     { start: string, end: string }
  categories: MatrixCategory[]
  rows:       MatrixRow[]
  col_totals: Record<string, MatrixCell>
}

export class PeriodReportService {
    public static getPeriodReport(
        startDate: string,
        endDate:   string,
    ): CancelablePromise<PeriodReport> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tools/period-report',
            query: {
                'start_date': startDate,
                'end_date':   endDate,
            },
        });
    }

    public static getChannelCategoryMatrix(
        startDate: string,
        endDate:   string,
    ): CancelablePromise<ChannelCategoryMatrix> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tools/period-report/channel-matrix',
            query: {
                'start_date': startDate,
                'end_date':   endDate,
            },
        });
    }

    public static getRegulatoryReport(
        referenceDate: string,
    ): CancelablePromise<RegulatoryReport> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tools/period-report/regulatory',
            query: {
                'reference_date': referenceDate,
            },
        });
    }
}

// ── Regulatory report (Trimestre courant) ────────────────────────────────────

/** A row split by gender — null values render as empty cells. */
export type GenderPair = { homme: number | null, femme: number | null }

export type RegulatoryReport = {
  reference_date:     string
  reference_date_ymd: string

  clients:              GenderPair    // Row 1 — kept empty per business spec
  accounts_registered:  GenderPair    // Row 2
  accounts_active_90d:  GenderPair    // Row 3
  accounts_dormant_90d: GenderPair    // Row 4

  agents_registered:     number | null  // Row 5
  agents_active_90d:     number | null  // Row 6
  agents_dormant_90d:    number | null  // Row 7

  merchants_registered:  number | null  // Row 8
  merchants_active_90d:  number | null  // Row 9
  merchants_dormant_90d: number | null  // Row 10

  transactions_volume:           number | null  // Row 11
  transactions_value_thousands:  number | null  // Row 12
}
