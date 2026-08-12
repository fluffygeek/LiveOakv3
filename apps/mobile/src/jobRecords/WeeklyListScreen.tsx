import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ScrollView, StyleSheet, Text, View } from "react-native";
import type { JobRecord } from "@liveoakv3/shared";
import { getMyWeeklyJobRecords } from "./api";

const EASTERN_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
};

function formatWeekRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  // endIso is the exclusive start of the *next* week — display the inclusive last day (Saturday).
  const lastDay = new Date(new Date(endIso).getTime() - 1);
  const formatter = new Intl.DateTimeFormat("en-US", EASTERN_DATE_FORMAT);
  return `${formatter.format(start)} – ${formatter.format(lastDay)}`;
}

function formatSubmittedAt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function WeeklyListScreen() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [window, setWindow] = useState<{ startIso: string; endIso: string } | null>(null);
  const [records, setRecords] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Guards against a slower response for an earlier weekOffset overwriting
  // state after a faster, more recent request (e.g. rapid "Prior week" taps).
  const latestRequestId = useRef(0);

  const load = useCallback(async (offset: number) => {
    const requestId = ++latestRequestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await getMyWeeklyJobRecords(offset);
      if (requestId !== latestRequestId.current) return;
      setWindow({ startIso: result.startIso, endIso: result.endIso });
      setRecords(result.records);
    } catch (err) {
      if (requestId !== latestRequestId.current) return;
      setError(err instanceof Error ? err.message : "Failed to load your weekly list");
    } finally {
      if (requestId === latestRequestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(weekOffset);
  }, [load, weekOffset]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.weekHeader}>
        <Button title="◀ Prior week" onPress={() => setWeekOffset((offset) => offset - 1)} />
        <Text style={styles.weekLabel}>
          {window ? formatWeekRange(window.startIso, window.endIso) : "…"}
        </Text>
        <Button
          title="Next week ▶"
          onPress={() => setWeekOffset((offset) => offset + 1)}
          disabled={weekOffset >= 0}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? <Text>Loading…</Text> : null}

      {!loading && records.length === 0 ? (
        <Text style={styles.empty}>
          No Job Records submitted {weekOffset === 0 ? "this week" : "that week"}.
        </Text>
      ) : null}

      {records.map((record) => (
        <View key={record.recordId} style={styles.card}>
          <Text style={styles.cardTitle}>{record.jobId}</Text>
          <Text>{record.address}</Text>
          <Text>{record.workCode}</Text>
          <Text style={styles.timestamp}>{formatSubmittedAt(record.submittedAt)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 8,
  },
  weekHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  weekLabel: {
    fontWeight: "600",
  },
  error: {
    color: "#b00020",
  },
  empty: {
    color: "#666",
    marginTop: 16,
  },
  card: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    padding: 12,
    gap: 2,
  },
  cardTitle: {
    fontWeight: "600",
  },
  timestamp: {
    color: "#666",
  },
});
