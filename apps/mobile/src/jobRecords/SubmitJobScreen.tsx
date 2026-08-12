import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Picker } from "@react-native-picker/picker";
import * as ImagePicker from "expo-image-picker";
import { findWorkCode, WORK_CODES } from "@liveoakv3/shared";
import { submitJobRecord } from "./api";
import { errorMessage, isLikelyOffline } from "./errorClassification";
import { syncQueuedSubmissions } from "./sync";
import {
  clearDraft,
  enqueueSubmission,
  getDraft,
  saveDraft,
  type JobRecordDraft,
} from "./storage";
import { useJobRecordSync } from "./useJobRecordSync";

const EMPTY_DRAFT: JobRecordDraft = {
  jobId: "",
  address: "",
  workCode: WORK_CODES[0]?.code ?? "",
  footage: "",
  notes: "",
  isNewBuild: false,
  photoUris: [],
};

export function SubmitJobScreen() {
  const [draft, setDraft] = useState<JobRecordDraft>(EMPTY_DRAFT);
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useJobRecordSync();

  useEffect(() => {
    void getDraft().then((existing) => {
      setDraft(existing ?? EMPTY_DRAFT);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    void saveDraft(draft);
  }, [draft, loaded]);

  const workCode = findWorkCode(draft.workCode);
  const minPhotos = workCode?.minPhotos ?? 0;
  const hasEnoughPhotos = draft.photoUris.length >= minPhotos;
  const footageValue = Number(draft.footage);
  const isFootageValid =
    draft.footage.trim().length > 0 && Number.isInteger(footageValue) && footageValue >= 0;
  const canSubmit =
    draft.jobId.trim().length > 0 &&
    draft.address.trim().length > 0 &&
    isFootageValid &&
    hasEnoughPhotos &&
    !submitting;

  async function pickPhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Camera access needed", "Enable camera access to attach job photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      setDraft((prev) => ({ ...prev, photoUris: [...prev.photoUris, result.assets[0].uri] }));
    }
  }

  function removePhoto(uri: string) {
    setDraft((prev) => ({ ...prev, photoUris: prev.photoUris.filter((p) => p !== uri) }));
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    const submission = {
      jobId: draft.jobId.trim(),
      address: draft.address.trim(),
      workCode: draft.workCode,
      footage: footageValue,
      notes: draft.notes,
      isNewBuild: draft.isNewBuild,
      // Local device URIs for now — see the note in storage.ts about
      // Cloud Storage upload being a follow-up, not yet wired here.
      photoUrls: draft.photoUris,
      submittedAt: new Date().toISOString(),
    };

    try {
      // Best-effort immediate submit; queue it for background sync only if
      // the failure looks like connectivity trouble. A real server
      // rejection (bad input, no permission, etc.) would just fail the
      // same way on every retry, so it must surface to the Technician now
      // instead of being silently queued forever.
      await submitJobRecord(submission);
      await clearDraft();
      setDraft(EMPTY_DRAFT);
      Alert.alert("Submitted", "Job record submitted.");
    } catch (error) {
      if (isLikelyOffline(error)) {
        await enqueueSubmission(submission);
        void syncQueuedSubmissions();
        setDraft(EMPTY_DRAFT);
        Alert.alert("Saved offline", "No connection — this will submit automatically once you're back online.");
      } else {
        Alert.alert("Submission failed", errorMessage(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!loaded) {
    return null;
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Job ID</Text>
      <TextInput
        style={styles.input}
        value={draft.jobId}
        onChangeText={(jobId) => setDraft((prev) => ({ ...prev, jobId }))}
        placeholder="Dispatch job ID"
      />

      <Text style={styles.label}>Address</Text>
      <TextInput
        style={styles.input}
        value={draft.address}
        onChangeText={(address) => setDraft((prev) => ({ ...prev, address }))}
        placeholder="Street address"
      />

      <View style={styles.row}>
        <Text style={styles.label}>New build (skip address verification)</Text>
        <Switch
          value={draft.isNewBuild}
          onValueChange={(isNewBuild) => setDraft((prev) => ({ ...prev, isNewBuild }))}
        />
      </View>

      <Text style={styles.label}>Work code</Text>
      <Picker
        selectedValue={draft.workCode}
        onValueChange={(workCode: string) => setDraft((prev) => ({ ...prev, workCode }))}
      >
        {WORK_CODES.map((code) => (
          <Picker.Item key={code.code} label={`${code.code} — ${code.description}`} value={code.code} />
        ))}
      </Picker>

      <Text style={styles.label}>Footage (linear feet, whole number)</Text>
      <TextInput
        style={styles.input}
        value={draft.footage}
        onChangeText={(footage) => setDraft((prev) => ({ ...prev, footage }))}
        placeholder="0"
        keyboardType="number-pad"
      />

      <Text style={styles.label}>Notes</Text>
      <TextInput
        style={[styles.input, styles.notesInput]}
        value={draft.notes}
        onChangeText={(notes) => setDraft((prev) => ({ ...prev, notes }))}
        placeholder="Relevant notes"
        multiline
      />

      <Text style={styles.label}>
        Photos ({draft.photoUris.length}/{minPhotos} minimum for {draft.workCode})
      </Text>
      <View style={styles.photoRow}>
        {draft.photoUris.map((uri) => (
          <View key={uri} style={styles.photoWrapper}>
            <Image source={{ uri }} style={styles.photo} />
            <Button title="Remove" onPress={() => removePhoto(uri)} />
          </View>
        ))}
      </View>
      <Button title="Add photo" onPress={() => void pickPhoto()} />

      <View style={styles.submitButton}>
        <Button title="Submit" onPress={() => void handleSubmit()} disabled={!canSubmit} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 8,
  },
  label: {
    fontWeight: "600",
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    padding: 8,
  },
  notesInput: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  photoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  photoWrapper: {
    alignItems: "center",
  },
  photo: {
    width: 80,
    height: 80,
    borderRadius: 6,
  },
  submitButton: {
    marginTop: 16,
  },
});
