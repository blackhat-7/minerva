/** Props every widget receives. `props` comes from the lesson and was validated against the widget's
 * catalog schema (shared/widgets/<name>.json); every field is optional, so apply defaults.
 * Call `onState` whenever controls change with the control values and key derived numbers; the tutor
 * sees it, so use clear keys and units, e.g. { batch: 8, intensity_flops_per_byte: 16, bound: "memory" }. */
export type WidgetProps<P> = {
  props: Partial<P>
  onState?: (state: Record<string, unknown>) => void
}
