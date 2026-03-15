export default async function EpisodeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight">Episode Detail</h2>
      <p className="mt-2 text-muted-foreground">
        Episode ID: {id}
      </p>
    </div>
  );
}
