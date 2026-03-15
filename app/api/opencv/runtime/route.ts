export const runtime = "nodejs";

export function GET(request: Request) {
  return Response.redirect(new URL("/vendor/opencv.js", request.url), 307);
}
