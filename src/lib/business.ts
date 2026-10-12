// Perfil del TENANT (white label): identidad del negocio que usa el sistema.
// Fuente única del NAP (Name-Address-Phone) para footer, /contacto, JSON-LD
// y WhatsApp. REBRANDING = editar estos valores (o sobreescribirlos con
// variables PUBLIC_* en .env antes de compilar) — nada más toca el código.
//
export const business = {
  name: 'Rapidoz Rental',
  phone: '+529999999999',
  phoneDisplay: '(999) 999 9999',
  whatsapp: '529999999999',
  email: 'hola@rapidozrental.mx',
  address: {
    street: 'Aeropuerto Internacional de Mérida',
    locality: 'Mérida',
    region: 'Yucatán',
    postalCode: '97300',
    country: 'MX',
  },
  addressDisplay: 'Aeropuerto Internacional de Mérida, Mérida, Yucatán, MX',
  geo: { lat: 20.9373, lng: -89.6578 },
  openingHours: 'Mo-Sa 08:00-20:00, Su 09:00-15:00',
  mapsUrl:
    'https://www.google.com/maps/search/?api=1&query=Aeropuerto+Internacional+de+M%C3%A9rida',
} as const;

// Prefijo del código de reservación (RPZ-XXXXXX). Vive aquí para que el
// rebranding no toque el generador ni los mensajes.
export const bookingCodePrefix = 'RPZ';

// Créditos del autor que se muestran en el footer público.
export const author = {
  name: 'Jorge Solís',
  url: 'https://github.com/JS-Taiyou',
} as const;
