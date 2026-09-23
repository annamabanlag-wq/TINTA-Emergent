import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSession } from "../../src/session";
import { api } from "../../src/api";
import { adminApi, AdminUser } from "../../src/adminApi";
import { colors, spacing } from "../../src/theme";

type Registration = {
  id: string;
  email: string;
  name: string;
  role: "customer" | "artist";
  status: string;
  created_at: string;
  email_verified: boolean;
  artist_application_id?: string | null;
  artist_id?: string | null;
  application_submitted_at?: string | null;
  application_reviewed_at?: string | null;
};

type ArtistApplication = {
  id: string;
  user_id: string;
  status: string;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  artist_id?: string | null;
};

function buildRows(users: AdminUser[], applications: ArtistApplication[]): Registration[] {
  const latestApplication = new Map<string, ArtistApplication>();

  for (const application of applications) {
    const uid = String(application.user_id || "");
    if (uid && !latestApplication.has(uid)) latestApplication.set(uid, application);
  }

  return users.map((user) => {
    const raw = user as AdminUser & {
      role?: string;
      artist_portal?: boolean;
      email_verified?: boolean;
      artist_identity_verified?: boolean;
    };

    const role: "customer" | "artist" =
      raw.role === "artist" || raw.artist_portal === true ? "artist" : "customer";

    const application = role === "artist" ? latestApplication.get(user.id) : undefined;

    let status = "registered";
    if (role === "artist") {
      status = application?.status || "account_created";
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role,
      status,
      created_at: user.created_at,
      email_verified: Boolean(raw.email_verified),
      artist_application_id: application?.id ?? null,
      artist_id: application?.artist_id ?? null,
      application_submitted_at: application?.submitted_at ?? null,
      application_reviewed_at: application?.reviewed_at ?? null,
    };
  });
}

export default function AdminRegistrations() {
  const { token, user } = useSession();
  const [rows, setRows] = useState<Registration[]>([]);
  const [filter, setFilter] = useState<"all" | "customer" | "artist">("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      // Use the live production backend endpoints already serving the admin
      // console. This avoids depending on the separate source-backend service.
      const [users, applications] = await Promise.all([
        adminApi.listUsers(token),
        api<ArtistApplication[]>("/admin/artist-applications", {}, token),
      ]);
      setRows(buildRows(users, applications));
    } catch (e) {
      console.warn("admin registrations", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => filter === "all" ? rows : rows.filter((row) => row.role === filter),
    [filter, rows],
  );

  if (!user?.is_admin) {
    return <View style={styles.center}><Text style={styles.title}>ADMIN ONLY</Text></View>;
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={colors.brand}
        />
      }
    >
      <Text style={styles.title}>REGISTRATIONS</Text>
      <Text style={styles.subtitle}>EVERY CUSTOMER AND ARTIST SIGNUP</Text>

      <View style={styles.summary}>
        <Summary label="TOTAL" value={rows.length} />
        <Summary label="CUSTOMERS" value={rows.filter((r) => r.role === "customer").length} />
        <Summary label="ARTISTS" value={rows.filter((r) => r.role === "artist").length} />
        <Summary label="PENDING ARTISTS" value={rows.filter((r) => r.role === "artist" && r.status === "pending").length} />
      </View>

      <View style={styles.filters}>
        {(["all", "customer", "artist"] as const).map((value) => (
          <Pressable
            key={value}
            onPress={() => setFilter(value)}
            style={[styles.filter, filter === value && styles.filterActive]}
          >
            <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>
              {value.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
      ) : filtered.length === 0 ? (
        <Text style={styles.empty}>NO REGISTRATIONS FOUND.</Text>
      ) : filtered.map((row) => (
        <View key={row.id} style={styles.card} testID={`registration-row-${row.id}`}>
          <View style={styles.rowTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{row.name || "—"}</Text>
              <Text style={styles.email}>{row.email}</Text>
            </View>
            <Text style={styles.role}>{row.role.toUpperCase()}</Text>
          </View>

          <View style={styles.metaLine}>
            <Text style={styles.status}>{row.status.replace(/_/g, " ").toUpperCase()}</Text>
            <Text style={styles.date}>
              {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
            </Text>
          </View>

          {row.role === "artist" ? (
            <Text style={styles.detail}>
              {row.artist_application_id
                ? `ARTIST APPLICATION: ${row.status.toUpperCase()}`
                : "ARTIST ACCOUNT CREATED — APPLICATION NOT SUBMITTED"}
            </Text>
          ) : (
            <Text style={styles.detail}>CUSTOMER ACCOUNT REGISTERED</Text>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  title: { color: colors.onSurface, fontSize: 32, fontWeight: "900", letterSpacing: 2 },
  subtitle: { color: colors.brand, fontSize: 11, fontWeight: "900", letterSpacing: 2, marginTop: 4, marginBottom: spacing.lg },
  summary: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  summaryCard: { flexGrow: 1, minWidth: "22%", borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSecondary, padding: spacing.md },
  summaryValue: { color: colors.onSurface, fontSize: 23, fontWeight: "900" },
  summaryLabel: { color: colors.muted, fontSize: 8, fontWeight: "900", letterSpacing: 1.2, marginTop: 4 },
  filters: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  filter: { paddingHorizontal: spacing.md, paddingVertical: 9, borderWidth: 2, borderColor: colors.border },
  filterActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  filterText: { color: colors.onSurface, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  filterTextActive: { color: colors.onBrand },
  card: { backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  rowTop: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  name: { color: colors.onSurface, fontSize: 17, fontWeight: "900" },
  email: { color: colors.muted, fontSize: 12, marginTop: 3 },
  role: { color: colors.brand, fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },
  metaLine: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  status: { color: colors.onSurface, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  date: { color: colors.muted, fontSize: 9 },
  detail: { color: colors.muted, fontSize: 11, marginTop: spacing.sm, letterSpacing: .5 },
  empty: { color: colors.muted, textAlign: "center", marginTop: spacing.xl, fontWeight: "900", letterSpacing: 1.5 },
});
