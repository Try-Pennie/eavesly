declare module "*.txt" {
  const content: string
  export default content
}

declare module "*.sql?raw" {
  const content: string
  export default content
}
