// Widget registry. A widget = a component here + a catalog entry in shared/widgets/<name>.json
// (description and props JSON Schema the lesson generator sees; `example` is used by the gallery).
import { lazy, type ComponentType } from 'react'
import type { WidgetProps } from './types'

type AnyWidget = ComponentType<WidgetProps<Record<string, unknown>>>

export const widgets: Record<string, AnyWidget> = {
  roofline: lazy(() => import('./roofline')),
  collective: lazy(() => import('./collective')),
  parallel_memory: lazy(() => import('./parallel_memory')),
  pipeline_schedule: lazy(() => import('./pipeline_schedule')),
  kv_cache: lazy(() => import('./kv_cache')),
  inference_latency: lazy(() => import('./inference_latency')),
  training_cost: lazy(() => import('./training_cost')),
} as Record<string, AnyWidget>

export type CatalogEntry = {
  name: string
  description: string
  props: Record<string, unknown>
  example: Record<string, unknown>
}

export const catalog: CatalogEntry[] = Object.values(
  import.meta.glob<CatalogEntry>('../../../shared/widgets/*.json', { eager: true, import: 'default' }),
).sort((a, b) => a.name.localeCompare(b.name))
