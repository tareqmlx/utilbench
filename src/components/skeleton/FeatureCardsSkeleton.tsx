import { SkeletonCircle, SkeletonLine } from "./SkeletonPrimitives";

export function FeatureCardsSkeleton() {
  return (
    <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-6">
          <SkeletonCircle size="size-8" className="mb-4" />
          <SkeletonLine width="w-2/5" height="h-5" className="mb-3" />
          <div className="space-y-2">
            <SkeletonLine width="w-full" height="h-3" />
            <SkeletonLine width="w-4/5" height="h-3" />
          </div>
        </div>
      ))}
    </div>
  );
}
