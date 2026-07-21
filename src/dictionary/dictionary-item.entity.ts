import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('dictionary_items')
export class DictionaryItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId!: string;

  @ManyToOne(() => User, (user) => user.dictionaryItems, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 120 })
  word!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  phonetic!: string | null;

  @Column({ type: 'text' })
  definition!: string;

  @Column({ type: 'text', default: '' })
  example!: string;

  @Column({ type: 'varchar', length: 64, default: 'Học Tiếng Anh' })
  category!: string;

  @Column({ name: 'recording_id', type: 'varchar', length: 36, nullable: true })
  recordingId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt!: Date | null;
}
