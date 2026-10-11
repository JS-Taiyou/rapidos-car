import { Toaster as Sonner, toast } from 'sonner';

// Envoltura de sonner sin next-themes (no hay sistema de temas en el MVP).
function Toaster(props: React.ComponentProps<typeof Sonner>) {
  return <Sonner theme="light" position="top-center" richColors {...props} />;
}

export { Toaster, toast };
