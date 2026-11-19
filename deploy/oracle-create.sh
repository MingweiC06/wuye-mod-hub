set -e
C=$OCI_TENANCY
KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA20d/jo1uhGj+JMroX57ATaHVThAoO2lBDN4e0qCx15 wuye-azure'
q() { oci "$@" --query 'data.id' --raw-output; }
VCN=$(q network vcn create -c $C --cidr-block 10.0.0.0/16 --display-name wuye-vcn --wait-for-state AVAILABLE)
IGW=$(q network internet-gateway create -c $C --vcn-id $VCN --is-enabled true --display-name wuye-igw --wait-for-state AVAILABLE)
RT=$(oci network vcn get --vcn-id $VCN --query 'data."default-route-table-id"' --raw-output)
oci network route-table update --rt-id $RT --force --route-rules "[{\"destination\":\"0.0.0.0/0\",\"networkEntityId\":\"$IGW\"}]" >/dev/null
SL=$(oci network vcn get --vcn-id $VCN --query 'data."default-security-list-id"' --raw-output)
oci network security-list update --security-list-id $SL --force \
 --egress-security-rules '[{"destination":"0.0.0.0/0","protocol":"all"}]' \
 --ingress-security-rules '[{"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},{"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},{"source":"0.0.0.0/0","protocol":"6","tcpOptions":{"destinationPortRange":{"min":443,"max":443}}}]' >/dev/null
SUB=$(q network subnet create -c $C --vcn-id $VCN --cidr-block 10.0.0.0/24 --display-name wuye-subnet --wait-for-state AVAILABLE)
IMG=$(oci compute image list -c $C --operating-system "Canonical Ubuntu" --operating-system-version 24.04 --shape VM.Standard.E2.1.Micro --sort-by TIMECREATED --query 'data[0].id' --raw-output)
printf '%s\n' "$KEY" > key.pub
printf '#!/bin/bash\niptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT\niptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT\nnetfilter-persistent save || true\n' > init.sh
for AD in $(oci iam availability-domain list -c $C --query 'data[].name' --raw-output | tr -d '[]",'); do
  echo "trying $AD"
  if VM=$(q compute instance launch -c $C --availability-domain $AD --shape VM.Standard.E2.1.Micro --image-id $IMG --subnet-id $SUB --assign-public-ip true --display-name wuye-mod-hub --ssh-authorized-keys-file key.pub --user-data-file init.sh --wait-for-state RUNNING); then break; fi
done
IP=$(oci compute instance list-vnics --instance-id $VM --query 'data[0]."public-ip"' --raw-output)
echo "WUYE_IP=$IP"
