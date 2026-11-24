-- The API checks the acting seller or verifies carrier tracking before recording delivery.
revoke execute on function
  public.apply_tracking_event(uuid, text, text, timestamptz, text, text, text, text, text, text, varchar, text, uuid, jsonb),
  public.apply_shipment_delivered_quantities(uuid)
from public, anon, authenticated;
revoke insert, update, delete on public.tracking_events, public.shipment_trackings, public.shipments
from public, anon, authenticated;
