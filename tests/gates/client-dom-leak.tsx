export function BrokenWebOnlyView() {
  const href = window.location.href;
  return <div>{href}</div>;
}
