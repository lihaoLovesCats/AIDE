export function greet(name: string): string {
  return `Hello, ${name}!`
}

if (typeof document !== 'undefined') {
  document.querySelector<HTMLDivElement>('#app')!.textContent = greet('AIDE')
}
