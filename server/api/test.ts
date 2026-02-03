export default defineEventHandler(async (event) => {
  console.log('called /api/test with method:', getMethod(event))
  return { ok: true }
})
