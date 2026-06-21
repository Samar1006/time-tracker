export const environment = {
  production: false,
  // Call backend directly — CORS is enabled on the server. Avoids ng serve proxy hangs.
  apiUrl: 'http://localhost:4000',
  googleClientId: ''
};
