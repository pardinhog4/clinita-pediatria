import { PublicSignature } from '@/components/organisms/signature-pad';
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  return <PublicSignature token={(await params).token} />;
}
