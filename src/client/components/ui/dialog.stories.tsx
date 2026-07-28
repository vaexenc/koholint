import {Button} from "@/client/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/client/components/ui/dialog";
import {Input} from "@/client/components/ui/input";
import type {Meta, StoryObj} from "@storybook/tanstack-react";

const meta = {
	title: "UI/Dialog",
	component: Dialog,
	parameters: {layout: "centered"},
} satisfies Meta<typeof Dialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
	render: () => (
		<Dialog>
			<DialogTrigger asChild>
				<Button>Open dialog</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Are you sure?</DialogTitle>
					<DialogDescription>
						This action can't be undone. The room and its history are removed
						permanently.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="ghost">Cancel</Button>
					</DialogClose>
					<Button variant="destructive">Delete</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	),
};

export const WithForm: Story = {
	render: () => (
		<Dialog>
			<DialogTrigger asChild>
				<Button>Edit profile</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit profile</DialogTitle>
					<DialogDescription>Update your display name, then save.</DialogDescription>
				</DialogHeader>
				<Input defaultValue="Marin" />
				<DialogFooter showCloseButton>
					<Button>Save</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	),
};

// no corner close button; the footer's own control is the only way out.
export const WithoutCloseButton: Story = {
	render: () => (
		<Dialog>
			<DialogTrigger asChild>
				<Button>Heads up</Button>
			</DialogTrigger>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>Heads up</DialogTitle>
					<DialogDescription>Acknowledge to continue.</DialogDescription>
				</DialogHeader>
				<DialogFooter showCloseButton />
			</DialogContent>
		</Dialog>
	),
};

export const ScrollableContent: Story = {
	render: () => (
		<Dialog>
			<DialogTrigger asChild>
				<Button>Terms</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Terms of service</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-3">
					{Array.from({length: 20}, (_, index) => (
						<p key={index} className="text-muted-foreground">
							Section {index + 1}. The island of Koholint is only a dream, and the
							Wind Fish must awaken.
						</p>
					))}
				</div>
			</DialogContent>
		</Dialog>
	),
};
