import { db } from "@onecli/db";

const main = async () => {
  const did = process.env.OPENVTC_APPROVER_DID;
  if (!did) throw new Error("OPENVTC_APPROVER_DID is required");
  const externalAuthId = `openvtc:${did}`;
  const user = await db.user.upsert({
    where: { externalAuthId },
    create: {
      externalAuthId,
      email: "openvtc-manager@demo.onecomputer.local",
      name: "OpenVTC Manager",
      approvalDid: did,
    },
    update: { name: "OpenVTC Manager", approvalDid: did },
  });
  await db.organizationMember.upsert({
    where: {
      organizationId_userId: { organizationId: "demo-corp-org", userId: user.id },
    },
    create: {
      organizationId: "demo-corp-org",
      userId: user.id,
      userEmail: user.email,
      role: "manager",
    },
    update: { userEmail: user.email, role: "manager" },
  });
  console.log(JSON.stringify({ managerUserId: user.id, organizationId: "demo-corp-org", role: "manager" }));
};

await main();
await db.$disconnect();
