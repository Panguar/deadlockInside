import { PlayerProfile } from "@/components/PlayerProfile";

export default async function PlayerPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  return <PlayerProfile accountId={accountId} />;
}
