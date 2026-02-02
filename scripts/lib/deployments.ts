import fs from "node:fs";
import path from "node:path";

export type DeploymentNetwork = "base" | "base-sepolia";

export type EvmDeployment = {
    chainId: number;
    network: DeploymentNetwork;
    contracts: {
        cartToken: `0x${string}` | "";
        identityRegistry: `0x${string}` | "";
        trustEngine: `0x${string}` | "";
        reputationRegistry: `0x${string}` | "";
        validationBridge: `0x${string}` | "";
        gatewaySession: `0x${string}` | "";
    };
    tokens: {
        usdc: `0x${string}`;
    };
};

export function getDeploymentPath(network: DeploymentNetwork) {
    return path.resolve(__dirname, "..", "..", "deployments", `${network}.json`);
}

export function readDeployment(network: DeploymentNetwork): EvmDeployment {
    const deploymentPath = getDeploymentPath(network);
    const raw = fs.readFileSync(deploymentPath, "utf8");
    return JSON.parse(raw) as EvmDeployment;
}

export function writeDeployment(network: DeploymentNetwork, deployment: EvmDeployment) {
    const deploymentPath = getDeploymentPath(network);
    fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
    fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
}

export function getNetworkFromHardhatName(name: string): DeploymentNetwork {
    if (name === "base" || name === "base-sepolia") return name;
    throw new Error(`Unsupported network name: ${name}`);
}

export function getNetworkFromEnv(): DeploymentNetwork {
    const envNetwork = process.env.CART_NETWORK;
    if (envNetwork === "base" || envNetwork === "base-sepolia") return envNetwork;
    return "base-sepolia";
}

export function requireDeployedAddress(address: string, label: string): `0x${string}` {
    if (!address || address === "") {
        throw new Error(`${label} is not set for this network yet`);
    }
    return address as `0x${string}`;
}
