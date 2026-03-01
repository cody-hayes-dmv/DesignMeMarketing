import React from "react";
import LocalMapSnapshotRunner from "@/components/LocalMapSnapshotRunner";

const LocalMapSnapshotPage: React.FC = () => {
  return (
    <LocalMapSnapshotRunner
      heading="Local Map Snapshot"
      description="Run one-time local map heat grids for any business. Monthly allowance is consumed first, then purchased credits."
    />
  );
};

export default LocalMapSnapshotPage;
