// Datos NAP (Name-Address-Phone) del negocio — FUENTE ÚNICA. El footer,
// /contacto y el JSON-LD del layout leen de aquí: Google desconfía de
// negocios con datos que difieren entre páginas (spec §6).
// ⚠ TODO: confirmar con el dueño teléfono, dirección exacta, horario y URL
// de Google Business antes de publicar.
export const business = {
  name: 'Rapidoz Rental',
  phone: '+5219990000000',
  phoneDisplay: '+52 1 999 000 0000',
  whatsapp: '5219990000000',
  email: 'hola@rapidozrenta.mx',
  address: {
    street: 'Calle 60 Nte 339',
    locality: 'Mérida',
    region: 'Yucatán',
    postalCode: '97000',
    country: 'MX',
  },
  addressDisplay: 'Calle 60 Nte 339, Centro, 97000 Mérida, Yucatán, MX',
  geo: { lat: 20.9674, lng: -89.5926 },
  openingHours: 'Mo-Sa 08:00-20:00, Su 09:00-15:00',
  mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Aeropuerto+Internacional+de+M%C3%A9rida',
} as const;
