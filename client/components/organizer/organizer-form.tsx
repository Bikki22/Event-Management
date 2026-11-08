"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { ImageUpload } from "@/components/uploads/image-upload";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Textarea } from "@/components/ui/inputs";
import { useApplyOrganizer, useUpdateOrganizer } from "@/hooks/use-organizer";
import { ApiError } from "@/lib/api/client";
import { slugify, type OrganizerProfile, type ProfileInput } from "@/lib/api/organizer";
import { applyServerErrors } from "@/lib/form-errors";
import { organizerSchema, type OrganizerValues } from "@/lib/validation/organizer";

/** Create (apply) or edit the organizer profile. */
export function OrganizerForm({ profile }: { profile?: OrganizerProfile }) {
  const router = useRouter();
  const editing = !!profile;
  const apply = useApplyOrganizer();
  const update = useUpdateOrganizer();
  const saving = apply.isPending || update.isPending;

  const [formError, setFormError] = useState<string | null>(null);
  // logo: undefined = unchanged, string = new upload id, null = remove
  const [logo, setLogo] = useState<string | null | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [slugTouched, setSlugTouched] = useState(editing);

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    control,
    formState: { errors, isDirty },
  } = useForm<OrganizerValues>({
    resolver: zodResolver(organizerSchema),
    defaultValues: {
      orgName: profile?.orgName ?? "",
      slug: profile?.slug ?? "",
      bio: profile?.bio ?? "",
      website: profile?.website ?? "",
    },
  });
  const [orgName, slug, bio] = useWatch({ control, name: ["orgName", "slug", "bio"] });
  const effectiveSlug = slug || slugify(orgName ?? "");
  const renamingVerified = editing && profile.verificationStatus === "verified" && orgName.trim() !== profile.orgName;

  const nameField = register("orgName", {
    // suggest a slug from the name until the user edits the slug themselves
    onChange: (e) => {
      if (!slugTouched) setValue("slug", slugify(e.target.value), { shouldDirty: true });
    },
  });

  const onSubmit = handleSubmit((v) => {
    setFormError(null);
    const body: ProfileInput = {
      orgName: v.orgName,
      ...(v.slug ? { slug: v.slug } : {}),
      bio: v.bio || null,
      website: v.website || null,
      ...(typeof logo === "string" ? { logoUploadId: logo } : {}),
      ...(logo === null ? { logoUrl: null } : {}),
    };
    const onError = (err: unknown) => {
      if (err instanceof ApiError && err.code === "SLUG_TAKEN") {
        setError("slug", { type: "server", message: "That address is taken. Try another." }, { shouldFocus: true });
      } else if (err instanceof ApiError && err.code === "ALREADY_ORGANIZER") {
        router.replace("/dashboard");
      } else if (err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED") {
        setFormError("Verify your email first. Check your inbox for the link.");
      } else {
        setFormError(applyServerErrors(err, setError, ["orgName", "slug", "bio", "website"]));
      }
    };

    if (!editing) {
      // creating: optional fields that are empty are simply left out
      const create: ProfileInput = { orgName: body.orgName, ...(body.slug ? { slug: body.slug } : {}) };
      if (body.bio) create.bio = body.bio;
      if (body.website) create.website = body.website;
      if (body.logoUploadId) create.logoUploadId = body.logoUploadId;
      // mutateAsync, not mutate(…, { onSuccess }): the new profile lands in the cache and the
      // apply page swaps this form out, and per-call callbacks don't run after unmount
      apply
        .mutateAsync(create)
        .then(() => {
          toast.success("Application sent", { description: "We'll review your profile shortly." });
          router.push("/dashboard");
        })
        .catch(onError);
    } else {
      update.mutate(body, {
        onSuccess: ({ profile: p }) => {
          setLogo(undefined);
          toast.success(p.verificationStatus === "pending" && profile.verificationStatus !== "pending" ? "Saved and sent for review" : "Profile saved");
        },
        onError,
      });
    }
  });

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-6">
      <FormAlert message={formError} />

      <ImageUpload
        purpose="organizer_logo"
        label="Logo"
        currentUrl={logo === null ? null : profile?.logoUrl}
        onReady={(u) => setLogo(u.id)}
        onClear={editing && profile.logoUrl ? () => setLogo(null) : undefined}
        onBusyChange={setUploading}
        hint="Square works best. JPEG, PNG or WebP, at least 128×128px."
      />

      <Field label="Organization name" placeholder="Kathmandu Live Events" error={errors.orgName?.message} {...nameField} />
      {renamingVerified && (
        <FormAlert message="Renaming a verified organization sends it back for a quick review. Bio, website, logo and address changes don't." />
      )}

      <div>
        <Field
          label="Public address"
          placeholder="kathmandu-live"
          labelAside={<span className="text-[12px] text-muted">Optional</span>}
          error={errors.slug?.message}
          {...register("slug", { onChange: () => setSlugTouched(true) })}
        />
        {!errors.slug && (
          <p className="mt-1.5 text-[12.5px] text-muted">
            Your page: <span className="font-mono text-ink">/organizers/{effectiveSlug || "your-name"}</span>
            {!editing && !slug && " (generated from the name)"}
          </p>
        )}
      </div>

      <Textarea
        label="About"
        placeholder="What kind of events do you run? Who are they for?"
        rows={5}
        labelAside={<span className="text-[12px] text-muted">{(bio ?? "").length}/2000</span>}
        error={errors.bio?.message}
        {...register("bio")}
      />

      <Field
        label="Website or social page"
        type="url"
        inputMode="url"
        placeholder="https://instagram.com/yourpage"
        labelAside={<span className="text-[12px] text-muted">Optional</span>}
        error={errors.website?.message}
        {...register("website")}
      />

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button type="submit" loading={saving} disabled={uploading || (editing && !isDirty && logo === undefined)}>
          {editing ? "Save changes" : "Submit application"}
        </Button>
        {uploading && <span className="text-[13px] text-muted">Waiting for the logo upload…</span>}
      </div>
    </form>
  );
}
